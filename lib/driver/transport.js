/**
 * driver/transport.js —— cua-driver 的唯一物理调用层。
 *
 * 这是插件里**唯一** spawn cua-driver 的地方；其余模块只经 lib/cua.js 的
 * cuaCall/cuaDeliver。把 spawn、超时、退出码、非 JSON、contract 不匹配
 * 等传输层事实集中在这里，能力探测与响应归一化才有可测试的边界。
 *
 * 约定：
 * - argv 固定 ['call', <tool>, <json>]，shell:false；
 * - 单次调用超时 CUA_CALL_TIMEOUT_MS（默认 30s，最小 1s）；
 * - 结果就是 CLI stdout 的 JSON（CLI 已把 structuredContent 直接输出）；
 * - 错误带 kind，供上层决定是否自愈/重试/给升级指引。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logDriverCall } from '../trajectory.js'

/**
 * 解析引擎二进制路径（优先级）：
 *   1. 环境变量 CUA_DRIVER_BIN（显式指定）
 *   2. PATH 目录扫描（cua-driver / cua-driver.exe）
 *   3. 常见安装路径：~/.local/bin、/usr/local/bin、/opt/homebrew/bin、
 *      Windows %LOCALAPPDATA%、~/.cua-driver/packages/current（官方安装器布局）
 *   4. 兜底 'cua-driver'（交给 spawn 报 ENOENT，错误信息含自救指引）
 */
export function resolveBin() {
  const explicit = process.env.CUA_DRIVER_BIN
  if (explicit) return explicit
  const sep = process.platform === 'win32' ? ';' : ':'
  const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
  for (const dir of (process.env.PATH || '').split(sep)) {
    if (!dir) continue
    try { if (existsSync(join(dir, exe))) return join(dir, exe) } catch { /* 忽略 */ }
  }
  const common = [
    join(homedir(), '.local', 'bin', exe),
    `/usr/local/bin/${exe}`,
    `/opt/homebrew/bin/${exe}`,
    join(homedir(), 'AppData', 'Local', 'cua-driver', exe),
    // cua-driver 官方安装器默认布局：~/.cua-driver/packages/current/<exe>
    join(homedir(), '.cua-driver', 'packages', 'current', exe),
  ]
  for (const p of common) {
    try { if (existsSync(p)) return p } catch { /* 忽略 */ }
  }
  return 'cua-driver'
}

/** 单次驱动调用超时（毫秒）。 */
export function callTimeoutMs() {
  return Math.max(1000, Number(process.env.CUA_CALL_TIMEOUT_MS) || 30000)
}

/** 传输层错误：kind 决定上层是自愈、重试还是给升级指引。 */
export class DriverCallError extends Error {
  constructor(message, {
    kind = 'exit', tool = '', exitCode = null, stdout = '', stderr = '',
    timeoutMs = null, contract = null, cause = null,
  } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'DriverCallError'
    this.kind = kind
    this.tool = tool
    this.exitCode = exitCode
    this.stdout = stdout
    this.stderr = stderr
    this.timeoutMs = timeoutMs
    this.contract = contract
  }
}

/**
 * 从错误文本识别契约不匹配（CLI 与 daemon 版本不一致）。
 * 0.23.2 旧 CLI 连 0.53 daemon 时实测：
 *   `contract version 0.7.0 does not match SDK 0.8.0`
 * @returns {{daemonContract:string, sdkContract:string}|null}
 */
export function contractMismatchOf(text) {
  const m = String(text || '').match(/contract version\s+([0-9][0-9.]*)\s+does not match SDK\s+([0-9][0-9.]*)/i)
  return m ? { daemonContract: m[1], sdkContract: m[2] } : null
}

/** 会话已结束（daemon 空闲回收/重启），需要 start_session 自愈。 */
export function isSessionEndedText(text) {
  return /session '.*' has ended|revive it/i.test(String(text || ''))
}

function contractHint(contract) {
  return `cua-driver CLI 与 daemon 的 contract 不一致（daemon ${contract.daemonContract} / SDK ${contract.sdkContract}）：`
    + 'CLI 与 daemon 必须一起升级并重启 daemon（例如 cua-driver update --apply）。'
    + '只替换其中一个二进制仍会失败；升级后先跑 cua-driver status / doctor。'
}

function exitMessage(tool, code, msg, contract) {
  if (contract) return `${contractHint(contract)} 原始错误：cua-driver ${tool} 失败 (exit ${code}): ${msg.slice(0, 800)}`
  return `cua-driver ${tool} 失败 (exit ${code}): ${msg.slice(0, 800)}`
}

/**
 * 创建一个 transport（可注入 spawnImpl，离线测试用）。
 * @param {{bin?:string, timeoutMs?:number, spawnImpl?:Function, log?:Function}} [opts]
 */
export function createTransport(opts = {}) {
  const bin = opts.bin ?? resolveBin()
  const timeoutMs = opts.timeoutMs ?? callTimeoutMs()
  const spawnImpl = opts.spawnImpl ?? spawn
  const log = opts.log ?? logDriverCall

  /**
   * 单次调用（不含会话自愈、不含参数/响应归一化）。
   * @param {string} tool
   * @param {object} args
   * @returns {Promise<any>}
   */
  function rawCall(tool, args = {}) {
    const started = Date.now()
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawnImpl(bin, ['call', tool, JSON.stringify(args)], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (e) {
        const msg = `cua-driver 无法启动 (${bin}): ${e?.message || e}`
        log(tool, args, 0, null, msg)
        reject(new DriverCallError(msg, { kind: 'spawn', tool, cause: e }))
        return
      }
      let out = ''
      let err = ''
      let logged = false
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        try { child.kill() } catch { /* 忽略 */ }
        const msg = `cua-driver ${tool} timeout after ${timeoutMs}ms`
        log(tool, args, Date.now() - started, null, msg)
        reject(new DriverCallError(msg, { kind: 'timeout', tool, timeoutMs }))
      }, timeoutMs)
      const commitLog = (value, error) => {
        if (logged) return
        logged = true
        log(tool, args, Date.now() - started, value, error)
      }
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { err += d })
      child.on('error', (e) => {
        clearTimeout(timer)
        const hint = e.code === 'ENOENT'
          ? `未找到 cua-driver：请确保它已安装并在 PATH 中，或设置环境变量 CUA_DRIVER_BIN 指向完整路径（如 CUA_DRIVER_BIN=/path/to/cua-driver）。`
          : ''
        const msg = `cua-driver 无法启动 (${bin}): ${e.message}${hint ? ' ' + hint : ''}`
        commitLog(null, msg)
        reject(new DriverCallError(msg, { kind: 'spawn', tool, cause: e }))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (timedOut) return
        if (code !== 0) {
          const msg = (err || out).trim()
          const contract = contractMismatchOf(msg) || contractMismatchOf(err) || contractMismatchOf(out)
          const full = exitMessage(tool, code, msg || `exit ${code}`, contract)
          commitLog(null, msg || `exit ${code}`)
          reject(new DriverCallError(full, {
            kind: contract ? 'contract_mismatch' : (isSessionEndedText(msg) ? 'session_ended' : 'exit'),
            tool, exitCode: code, stdout: out, stderr: err, contract,
          }))
          return
        }
        try {
          const value = JSON.parse(out)
          commitLog(value, null)
          resolve(value)
        } catch {
          const msg = `cua-driver ${tool} 返回非 JSON: ${out.slice(0, 500)}`
          commitLog(null, `non-json: ${out.slice(0, 300)}`)
          reject(new DriverCallError(msg, { kind: 'nonjson', tool, stdout: out, stderr: err }))
        }
      })
    })
  }

  /**
   * 运行一次非 `call` 子命令（版本/状态探测用）。只读、固定 argv。
   * 非零退出不抛错（版本探测应能读到 stdout/stderr），只有 spawn/超时才抛。
   * @param {string[]} argv
   * @param {{timeoutMs?:number}} [opts]
   * @returns {Promise<{code:number, stdout:string, stderr:string}>}
   */
  function runOnce(argv, opts2 = {}) {
    const t = Math.max(500, Number(opts2.timeoutMs) || 5000)
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawnImpl(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) {
        reject(new DriverCallError(`cua-driver ${argv.join(' ')} 无法启动 (${bin}): ${e?.message || e}`,
          { kind: 'spawn', tool: argv[0], cause: e }))
        return
      }
      let out = ''
      let err = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        try { child.kill() } catch { /* 忽略 */ }
        reject(new DriverCallError(`cua-driver ${argv.join(' ')} timeout after ${t}ms`,
          { kind: 'timeout', tool: argv[0], timeoutMs: t }))
      }, t)
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { err += d })
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new DriverCallError(`cua-driver ${argv.join(' ')} 无法启动 (${bin}): ${e?.message || e}`,
          { kind: 'spawn', tool: argv[0], cause: e }))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (timedOut) return
        resolve({ code: Number(code) || 0, stdout: out, stderr: err })
      })
    })
  }

  return { bin, timeoutMs, rawCall, runOnce }
}

/** 默认 transport：进程级单例，bin 在创建时解析一次。 */
export const defaultTransport = createTransport()
