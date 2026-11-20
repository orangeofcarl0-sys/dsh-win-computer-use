/**
 * nativeMenus.js —— 经典 Win32 HMENU 菜单后端（Windows，私有实现）。
 *
 * 立场：
 *  - 只在驱动 `invoke_menu` 明确结构化拒绝后兜底；驱动 unverifiable/超时/effect 缺失一律不回退，
 *    因为那些路径可能已经执行，再发 WM_COMMAND 会重复。
 *  - 只支持顶层窗口 `GetMenu` 的标准 HMENU；WinForms MenuStrip / WPF / WinUI 没有 HMENU，
 *    返回 no_hmenu，不退化为坐标点击。
 *  - 两阶段：resolve 只读解析路径并取 commandId；invoke 重新校验后再 PostMessage(WM_COMMAND)。
 *  - PostMessage 只证明消息已投递，不能证明命令执行；调用方必须报 effect:unverifiable。
 *  - 超时视为“可能已发送”：不重试、不换路径。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'native-menu.ps1')

export const IS_WINDOWS = process.platform === 'win32'

function defaultSpawn(cmd, args, opts) {
  return spawn(cmd, args, opts)
}

function errorResult(code, error) {
  return { ok: false, code: String(code || 'native_menu_failed'), error: String(error || code || 'native menu failed') }
}

/**
 * 执行一次 native-menu.ps1。与 nativeDialogs 的 runner 不同，这里必须区分
 * timeout（可能已发送）与 unavailable（零副作用），否则回执会把“未知”说成“未调用”。
 * @returns {Promise<{status:'ok'|'timeout'|'unavailable'|'error', value?:object, error?:string}>}
 */
function runSidecar(args, timeoutMs, spawnFn) {
  if ((!IS_WINDOWS && spawnFn === defaultSpawn) || !existsSync(SCRIPT)) {
    return Promise.resolve({ status: 'unavailable', error: 'native menu sidecar unavailable' })
  }
  const limit = Math.max(500, Number(timeoutMs) || 3000)
  return new Promise((resolve) => {
    let out = ''
    let child = null
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child?.kill() } catch { /* 已退出 */ }
      resolve(value)
    }
    const timer = setTimeout(() => finish({ status: 'timeout', error: `native menu timeout after ${limit}ms` }), limit)
    try {
      child = spawnFn(process.env.DSH_POWERSHELL || 'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      return finish({ status: 'unavailable', error: err instanceof Error ? err.message : String(err) })
    }
    child.stdout?.on?.('data', (d) => { out += d })
    child.stderr?.on?.('data', () => { /* 诊断进 stderr；失败由 JSON/退出码表达 */ })
    child.on?.('error', (err) => finish({ status: 'unavailable', error: err?.message ? String(err.message) : 'spawn failed' }))
    child.on?.('close', (code) => {
      if (settled) return
      if (code !== 0) return finish({ status: 'error', error: `native menu exited with code ${code}` })
      try {
        const line = out.trim().split(/\r?\n/).filter(Boolean).pop()
        const value = JSON.parse(line)
        if (!value || typeof value !== 'object') return finish({ status: 'error', error: 'non-object response' })
        finish({ status: 'ok', value })
      } catch (err) {
        finish({ status: 'error', error: `bad response: ${err instanceof Error ? err.message : String(err)}` })
      }
    })
  })
}

function normalizePath(path) {
  if (!Array.isArray(path)) return null
  const parts = path.map((s) => String(s ?? '').trim())
  return parts.length > 0 && parts.every(Boolean) ? parts : null
}

function pathArg(path) {
  return Buffer.from(JSON.stringify(path), 'utf8').toString('base64')
}

function titleArg(title) {
  return title ? Buffer.from(String(title), 'utf8').toString('base64') : ''
}

function diagOf(v) {
  const d = {}
  for (const k of ['hwndInput', 'hwndResolved', 'pidInput', 'pidActual', 'isWindow', 'visible', 'enabled', 'class', 'title', 'menu', 'menuCount', 'root', 'rootMenu', 'autoResolved', 'resolvedOk', 'candidates']) {
    if (v && v[k] !== undefined) d[k] = v[k]
  }
  return d
}

/**
 * 只读解析路径。成功返回 {ok:true, commandId, path, method:'resolve'}。
 * 失败返回 {ok:false, code, error}；超时也返回失败（未发送，可安全重试）。
 */
export async function resolveNativeMenu({ pid, hwnd, path, title = '' } = {}, opts = {}) {
  const parts = normalizePath(path)
  if (!Number.isFinite(Number(pid)) || Number(pid) <= 0) return errorResult('pid_missing', 'pid is required for native menu fallback')
  if (!Number.isFinite(Number(hwnd)) || Number(hwnd) <= 0) return errorResult('window_missing', 'window_id is required')
  if (!parts) return errorResult('bad_path', 'menu path must be a non-empty array of strings')
  const args = ['-Action', 'resolve', '-Pid', String(Number(pid)), '-Hwnd', String(Number(hwnd)), '-PathB64', pathArg(parts)]
  if (title) args.push('-TitleB64', titleArg(title))
  const res = await runSidecar(args, opts.timeoutMs || 3000, opts.spawnFn || defaultSpawn)
  if (res.status === 'unavailable') return errorResult('unavailable', res.error)
  if (res.status === 'timeout') return { ...errorResult('timeout', res.error), stage: 'resolve', unknown: false }
  if (res.status === 'error') return errorResult('failed', res.error)
  const v = res.value
  if (v.ok !== true) return { ...errorResult(v.code || 'failed', v.error || v.code), ...diagOf(v), stage: 'resolve' }
  return {
    ok: true,
    method: 'resolve',
    stage: 'resolve',
    hwnd: Number(v.hwnd) || Number(hwnd),
    commandId: Number(v.commandId),
    path: Array.isArray(v.path) ? v.path.map(String) : parts,
  }
}

/** 只读诊断：不发送任何消息。 */
export async function inspectNativeMenu({ pid, hwnd, title = '' } = {}, opts = {}) {
  if (!Number.isFinite(Number(pid)) || Number(pid) <= 0) return errorResult('pid_missing', 'pid is required for native menu inspect')
  const args = ['-Action', 'inspect', '-Pid', String(Number(pid)), '-Hwnd', String(Number(hwnd) || 0)]
  if (title) args.push('-TitleB64', titleArg(title))
  const res = await runSidecar(args, opts.timeoutMs || 3000, opts.spawnFn || defaultSpawn)
  if (res.status !== 'ok') return errorResult(res.status === 'timeout' ? 'timeout' : 'unavailable', res.error)
  return { ok: true, ...diagOf(res.value), code: String(res.value.code || ''), stage: 'inspect' }
}

/**
 * 重新解析并投递 WM_COMMAND。commandId 必须与 resolve 时一致，防止菜单在两次调用之间变化。
 * 超时 = 可能已发送，返回 ok:false + unknown:true；调用方不得重试。
 */
export async function invokeNativeMenu({ pid, hwnd, path, commandId, title = '' } = {}, opts = {}) {
  const parts = normalizePath(path)
  if (!Number.isFinite(Number(pid)) || Number(pid) <= 0) return errorResult('pid_missing', 'pid is required for native menu fallback')
  if (!Number.isFinite(Number(hwnd)) || Number(hwnd) <= 0) return errorResult('window_missing', 'window_id is required')
  if (!parts) return errorResult('bad_path', 'menu path must be a non-empty array of strings')
  const id = Number(commandId)
  if (!Number.isInteger(id) || id <= 0 || id > 0xffff) return errorResult('bad_command_id', 'commandId must be 1..65535')
  const args = ['-Action', 'invoke', '-Pid', String(Number(pid)), '-Hwnd', String(Number(hwnd)),
    '-PathB64', pathArg(parts), '-CommandId', String(id)]
  if (title) args.push('-TitleB64', titleArg(title))
  const res = await runSidecar(args, opts.timeoutMs || 3000, opts.spawnFn || defaultSpawn)
  if (res.status === 'unavailable') return errorResult('unavailable', res.error)
  if (res.status === 'timeout') {
    return { ok: false, code: 'timeout', unknown: true, stage: 'invoke', error: `${res.error}; WM_COMMAND may have been posted` }
  }
  if (res.status === 'error') return errorResult('failed', res.error)
  const v = res.value
  if (v.ok !== true) return { ...errorResult(v.code || 'failed', v.error || v.code), ...diagOf(v), stage: 'invoke' }
  return {
    ok: true,
    method: 'WM_COMMAND',
    stage: 'invoke',
    hwnd: Number(v.hwnd) || Number(hwnd),
    commandId: Number(v.commandId),
    path: Array.isArray(v.path) ? v.path.map(String) : parts,
  }
}

/** resolve → invoke。resolve 失败（含超时）零副作用；invoke 超时可能已发送。 */
export async function tryNativeMenu({ pid, hwnd, path, title = '' } = {}, opts = {}) {
  const r = await resolveNativeMenu({ pid, hwnd, path, title }, opts)
  if (!r.ok) return r
  return invokeNativeMenu({ pid, hwnd: r.hwnd, path: r.path, commandId: r.commandId, title }, opts)
}
