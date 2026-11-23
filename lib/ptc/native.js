/**
 * native.js —— PTC 的原生桥：show 复用 background-input helper，
 * scroll 调只读/可访问性 UIA ScrollPattern 脚本。
 *
 * 测试会用桩覆盖这个模块，或用 createScrollRunner / createShowWindow
 * 注入 fake spawn / fake native；默认导出保持原有行为。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { showWindowNative } from '../backgroundInput.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SCROLL_SCRIPT = join(HERE, '..', '..', 'tools', 'uia-scroll.ps1')

function errorResult(code, error) {
  return { ok: false, code, error: String(error || code), delivered: false }
}

function runScroll(spawnFn, scriptPath, args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawnFn(process.env.DSH_POWERSHELL || 'powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-Hwnd', String(args.hwnd),
        '-TargetPid', String(args.pid),
        '-ScreenX', String(args.screenX),
        '-ScreenY', String(args.screenY),
        '-DeltaX', String(args.deltaX),
        '-DeltaY', String(args.deltaY),
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    } catch (err) {
      resolve(errorResult('unavailable', err?.message || err))
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      finish(errorResult('timeout', `UIA scroll timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (err) => finish(errorResult('unavailable', err?.message || err)))
    child.on('close', (code) => {
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const last = lines[lines.length - 1] || ''
      try {
        const parsed = JSON.parse(last)
        finish(parsed && typeof parsed === 'object' ? parsed : errorResult('scroll_failed', 'non-object response'))
      } catch {
        const detail = stderr.trim().slice(0, 300)
        finish(errorResult('scroll_failed', `scroll helper exit ${code}${detail ? `: ${detail}` : ''}`))
      }
    })
  })
}

/**
 * 建立 scroll 执行器。默认参数与旧实现一致；测试可注入 fake spawn。
 * minTimeoutMs 只用于测试缩短等待，生产默认 1000。
 */
export function createScrollRunner({
  spawnFn = spawn,
  scriptPath = SCROLL_SCRIPT,
  exists = existsSync,
  platform = process.platform,
  minTimeoutMs = 1000,
} = {}) {
  const available = platform === 'win32' && Boolean(scriptPath) && exists(scriptPath)
  const unavailable = platform !== 'win32' ? 'scroll 仅支持 Windows' : `缺少 ${scriptPath}`

  return async function scrollAt(args, opts = {}) {
    if (!available) return errorResult('unavailable', unavailable)
    const floor = Math.max(1, Number(minTimeoutMs) || 1000)
    const timeoutMs = Math.max(floor, Number(opts.timeoutMs) || 8000)
    return runScroll(spawnFn, scriptPath, args, timeoutMs)
  }
}

/**
 * 在屏幕点按 UIA ScrollPattern 滚动。
 * @param {{pid:number,hwnd:number,screenX:number,screenY:number,deltaX:number,deltaY:number}} args
 * @returns {Promise<{ok:boolean,code?:string,error?:string,role?:string,name?:string,scrolled?:number}>}
 */
export const scrollAt = createScrollRunner()

/** 建立 show 执行器；默认走 background-input helper。 */
export function createShowWindow({ platform = process.platform, native = showWindowNative } = {}) {
  return async function showWindow(payload, opts = {}) {
    if (platform !== 'win32') return errorResult('unavailable', 'show 仅支持 Windows')
    return native(payload, opts)
  }
}

/** 非激活恢复窗口。 */
export const showWindow = createShowWindow()
