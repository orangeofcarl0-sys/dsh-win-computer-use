/**
 * nativeButtonTrigger.js —— 标准 Win32/WinForms Button 的原生触发（实验性，默认 off）。
 *
 * 只用于 computer_click(element=Button) 的单次左键：动作时重新枚举同 pid 的标准
 * `Button`/`WindowsForms10.BUTTON*` 子 HWND，要求 class/style/label/屏幕点全部唯一匹配，
 * 然后只发一次 PostMessage(BM_CLICK)。
 *
 * 语义：
 *  - 成功只证明 BM_CLICK 已投递，effect=unverifiable；不自动选择 Yes/No。
 *  - 明确未投递（no_match/ambiguous/window_not_found/...）→ 返回 null，交回 driver。
 *  - 目标已被模态禁用（owner_disabled）→ 返回拒绝，不回退 driver，避免再付 30s。
 *  - helper 超时/异常/坏响应 → 返回“结果未知”，不回退 driver，由 settleAction 标 suspect。
 *  - 10s latch 防止模态出现前重复触发。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'native-button.ps1')
const LATCH_MS = 10000

export const IS_WINDOWS = process.platform === 'win32'

const latch = new Map()

export function resetNativeButtonTrigger() {
  latch.clear()
}

function latchKey({ pid, hwnd, label }) {
  // 不绑定 element 序号：重新观察后序号可能变化，但同一窗口同一标签仍不应重复触发。
  return `${Number(pid) || 0}:${Number(hwnd) || 0}:${String(label || '')}`
}

function isLatched(key) {
  const at = latch.get(key)
  if (!at) return false
  if (Date.now() - at > LATCH_MS) {
    latch.delete(key)
    return false
  }
  return true
}

function markLatched(key) {
  latch.set(key, Date.now())
  if (latch.size > 64) {
    const now = Date.now()
    for (const [k, at] of latch) if (now - at > LATCH_MS) latch.delete(k)
  }
}

function defaultSpawn(cmd, args, opts) {
  return spawn(cmd, args, opts)
}

function runSidecar(args, timeoutMs, spawnFn) {
  if ((!IS_WINDOWS && spawnFn === defaultSpawn) || !existsSync(SCRIPT)) {
    return Promise.resolve({ status: 'unavailable', error: 'native button sidecar unavailable' })
  }
  const limit = Math.max(500, Number(timeoutMs) || 4000)
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
    const timer = setTimeout(() => finish({ status: 'timeout', error: `native button timeout after ${limit}ms` }), limit)
    try {
      child = spawnFn(process.env.DSH_POWERSHELL || 'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      return finish({ status: 'unavailable', error: err instanceof Error ? err.message : String(err) })
    }
    child.stdout?.on?.('data', (d) => { out += d })
    child.stderr?.on?.('data', () => { /* 诊断进 stderr */ })
    child.on?.('error', (err) => finish({ status: 'unavailable', error: err?.message ? String(err.message) : 'spawn failed' }))
    child.on?.('close', (code) => {
      if (settled) return
      if (code !== 0) return finish({ status: 'error', error: `native button exited with code ${code}` })
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

function preDelivery(code) {
  return new Set([
    'no_match', 'ambiguous', 'ambiguous_window', 'window_not_found', 'pid_mismatch',
    'bad_label', 'post_message_failed', 'enum_windows_failed',
  ]).has(String(code || ''))
}

function successResult(v) {
  return {
    value: {
      ok: true,
      effect: 'unverifiable',
      delivery: { mode: 'win32-control' },
      route: 'win32-native-button',
      method: 'BM_CLICK',
      button_hwnd: Number(v.buttonHwnd) || undefined,
      root_hwnd: Number(v.rootHwnd) || undefined,
      class_name: v.className ? String(v.className) : undefined,
      label: v.label ? String(v.label) : undefined,
    },
    note: '（原生 Win32 按钮：BM_CLICK 异步投递，未验证；等待 1–3s 再观察是否出现新同 pid 窗口；不要重复点击；对话框按钮仍由 native-dialog 处理。）',
    unverifiedNote: '（原生按钮：BM_CLICK 只证明消息已投递，不证明业务效果；先 screen_observe；不要在模态出现前重复点击。）',
    refusalNote: '',
  }
}

function unknownResult(error) {
  return {
    value: {
      ok: true,
      effect: 'unverifiable',
      delivery: { mode: 'win32-control' },
      route: 'win32-native-button',
      method: 'BM_CLICK',
      warning_code: 'native_button_unknown',
      error: String(error || 'result unknown'),
    },
    note: '（原生按钮：helper 超时/异常，结果未知，BM_CLICK 可能已发送；不要重复点击；先 screen_observe 确认是否出现新同 pid 窗口。）',
    unverifiedNote: '（原生按钮结果未知：不要重复；先观察新同 pid 窗口/对话框。）',
    refusalNote: '',
  }
}

function refusalResult(code, error) {
  return {
    value: {
      ok: false,
      code,
      error: String(error || code),
      delivery: { mode: 'win32-control' },
      route: 'win32-native-button',
      delivered: false,
    },
    note: '',
    unverifiedNote: '',
    refusalNote: code === 'owner_disabled'
      ? '（目标窗口已被模态禁用；本次未发送。先 screen_observe 同 pid 的新对话框，不要重复点击主窗口按钮。）'
      : '（原生按钮 10s 内已触发过；本次未发送。先 screen_observe 确认模态/界面，不要重复。）',
  }
}

/**
 * 返回 null = 不接管（交回 driver）；返回 {value,note,...} = 已处理。
 */
export async function tryNativeButtonClick({ pid, hwnd, title = '', label, x, y, element } = {}, opts = {}) {
  if (cfgOff(opts.cfg)) return null
  if (!Number.isFinite(Number(pid)) || Number(pid) <= 0) return null
  if (!Number.isFinite(Number(hwnd)) || Number(hwnd) <= 0) return null
  if (!label || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null
  const key = latchKey({ pid, hwnd, label, element })
  if (isLatched(key)) return refusalResult('native_button_latched', 'same button triggered within 10s')
  const args = [
    '-Action', 'trigger', '-Pid', String(Number(pid)), '-Hwnd', String(Number(hwnd)),
    '-LabelB64', Buffer.from(String(label), 'utf8').toString('base64'),
    '-ScreenX', String(Math.round(Number(x))), '-ScreenY', String(Math.round(Number(y))),
  ]
  if (title) args.push('-TitleB64', Buffer.from(String(title), 'utf8').toString('base64'))
  const res = await runSidecar(args, opts.timeoutMs || 4000, opts.spawnFn || defaultSpawn)
  if (res.status === 'unavailable') return null
  if (res.status === 'timeout' || res.status === 'error') {
    markLatched(key)
    return unknownResult(res.error)
  }
  const v = res.value
  if (v.ok === true) {
    markLatched(key)
    return successResult(v)
  }
  if (v.code === 'owner_disabled') {
    markLatched(key)
    return refusalResult('native_button_owner_disabled', v.error)
  }
  if (preDelivery(v.code)) return null
  markLatched(key)
  return unknownResult(v.error || v.code)
}

function cfgOff(cfg) {
  return !cfg || cfg.nativeButtonTrigger !== 'auto'
}
