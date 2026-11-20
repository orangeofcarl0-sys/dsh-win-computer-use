/**
 * backgroundInput.js —— 实验性 Windows 后台输入路由（B0/B1/B2/B3）。
 *
 * 立场：
 *  - 默认 off，三键（backgroundInput/syntheticPointer/anchoredInput）全关时零 spawn、
 *    零行为变化；路由只在快照没有可交互 UIA 元素时接管。
 *  - 插件通道是 driver 之外的 bypass：命中后不进 cuaDeliver，避免 L2/L3 重复投递；
 *    失败/未验证不自动换通道、不自动升级前台。
 *  - 每个通道必须标注扰动等级与副作用；B1 遮挡失败关闭，B2 还原光标，B3 还原窗口。
 *
 * 侧车协议：stdin/stdout 一行一个 JSON；启动先输出 {"ready":true}。
 * 坐标：传入 helper 的 x/y 为屏幕物理像素（virtual screen）；B3 额外传客户区坐标。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isActionableRole } from './roles.js'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'background-input.ps1')
const IDLE_MS = 120000
const READY_MS = 10000
const PROFILE_TTL_MS = 3000

export const IS_WINDOWS = process.platform === 'win32'

const POINTER_CLASSES = new Set([
  'UnityWndClass', 'UnrealWindow', 'SDL_app', 'GLFW30', 'GLFW',
  'CryENGINE', 'CrySystem', 'D3DWindow', 'RocketLeague',
])

const REFUSAL_TEXT = {
  background_input_occluded: '目标点被遮挡/不在目标窗口：本次未发送。请先 computer_activate 或移开遮挡窗口，再重试；不要重复同一动作。',
  background_input_anchor_blocked: '合成触控的锚点窗口被其他 topmost 窗口遮挡，无法保证主指针不被抢；本次未注入。请先关闭/移开遮挡窗口，或改用前台。',
  background_input_uipi: '目标完整性级别高于 helper；本次未发送。请以相同/更高完整性运行，或改用驱动/前台；不要尝试绕过 UIPI。',
  background_input_secure_desktop: '当前不是 Default 输入桌面（安全桌面/UAC）；本次未发送。不要尝试自动化 UAC。',
  background_input_clip_cursor: '目标/系统启用了 ClipCursor，光标无法到达目标点；本次未移动/未发送。请先让目标释放光标裁剪。',
  background_input_window_not_movable: '目标窗口不可移动（最大化/最小化/全屏或拒绝 SetWindowPos）；本次未发送。',
  background_input_window_move_failed: '目标窗口移动失败；本次未发送。',
  background_input_cursor_changed: '操作期间光标被外部移动，窗口锚定失准；本次未发送或结果未知。请先 observe，不要重复。',
  background_input_password_denied: '焦点/目标编辑框是密码框；拒绝自动输入。',
  background_input_timeout: '后台输入 helper 超时：结果未知。不要重复同一动作；先 screen_observe 确认界面。',
  background_input_helper_exited: '后台输入 helper 异常退出：结果未知。不要重复同一动作；先 screen_observe。',
  background_input_bad_response: '后台输入 helper 返回了不可解析的响应；本次结果未知。不要重复；先 observe。',
  background_input_failed: '后台输入未发送/失败；不要重复同一动作，先 screen_observe 确认。',
}

const UNVERIFIED_BY_MODE = {
  'background-message': '（后台消息：只证明 WM_* 已投递，不证明应用处理；先 screen_observe 确认；不要重复同一动作。）',
  'win32-control': '（控件消息：只证明消息已送达控件，不证明业务效果；先 screen_observe 确认；不要重复。）',
  'synthetic-pointer': '（合成触控：WM_POINTER 已注入，未移动光标/前台；应用是否处理未验证；先 observe；不要重复。）',
  'cursor-anchored': '（光标锚定：光标已临时移动并还原；用户输入在操作期间被阻塞；先 observe；不要重复。）',
  'window-anchored': '（窗口锚定：窗口已临时移动并还原；光标未移动；先 observe；不要重复。）',
}

function defaultSpawn(cmd, args, opts) {
  return spawn(cmd, args, opts)
}

function helperTemp() {
  const fallback = process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Local', 'Temp')
    : (process.env.TEMP || process.env.TMP || '')
  return process.env.S4_TEMP || process.env.DSH_TEMP || fallback
}

function errorObject(code, message) {
  return { ok: false, code, error: String(message || code), delivered: false }
}

/**
 * 持久侧车客户端。测试可注入 spawnFn/platform/scriptPath/exists，避免真实 PowerShell。
 */
export function createBackgroundInputClient({
  spawnFn = defaultSpawn,
  platform = process.platform,
  scriptPath = SCRIPT,
  exists = existsSync,
} = {}) {
  const available = platform === 'win32' && Boolean(scriptPath) && exists(scriptPath)
  let child = null
  let buffer = ''
  let inflight = null
  let queue = []
  let idleTimer = null
  let stderrTail = ''
  let starting = null
  let ready = false

  function resetChild(reason, code = 'background_input_helper_exited') {
    if (inflight) {
      clearTimeout(inflight.timer)
      inflight.reject(Object.assign(new Error(reason || 'background input helper exited'), { code }))
      inflight = null
    }
    for (const item of queue.splice(0)) item.reject(Object.assign(new Error(reason || 'background input helper exited'), { code }))
    child = null
    buffer = ''
    starting = null
    ready = false
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  }

  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (!inflight && queue.length === 0 && child) {
        try { child.stdin.end() } catch { /* ignore */ }
        try { child.kill() } catch { /* ignore */ }
        resetChild('background input helper idle exited')
      }
    }, IDLE_MS)
    if (typeof idleTimer.unref === 'function') idleTimer.unref()
  }

  function startChild() {
    if (!available) return Promise.resolve(false)
    if (child && ready) return Promise.resolve(true)
    if (starting) return starting
    starting = new Promise((resolve, reject) => {
      let settled = false
      let proc = null
      const finishReady = (ok, err) => {
        if (settled) return
        settled = true
        clearTimeout(readyTimer)
        starting = null
        if (ok) resolve(true)
        else reject(err || new Error('background input helper readiness failed'))
      }
      const readyTimer = setTimeout(() => {
        try { proc?.kill() } catch { /* ignore */ }
        resetChild('background input helper readiness timeout', 'background_input_unavailable')
        finishReady(false, Object.assign(new Error('background input helper readiness timeout'), { code: 'background_input_unavailable' }))
      }, READY_MS)
      if (typeof readyTimer.unref === 'function') readyTimer.unref()
      try {
        proc = spawnFn(process.env.DSH_POWERSHELL || 'powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
        ], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, TEMP: helperTemp(), TMP: helperTemp() },
        })
      } catch (err) {
        finishReady(false, Object.assign(err instanceof Error ? err : new Error(String(err)), { code: 'background_input_unavailable' }))
        return
      }
      child = proc
      buffer = ''
      stderrTail = ''
      ready = false
      proc.stdout.setEncoding('utf8')
      proc.stderr.setEncoding('utf8')
      proc.stdout.on('data', (chunk) => {
        buffer += chunk
        let idx
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, '')
          buffer = buffer.slice(idx + 1)
          if (!line.trim()) continue
          let parsed
          try { parsed = JSON.parse(line) } catch {
            if (!ready) {
              finishReady(false, Object.assign(new Error(`background input helper emitted non-JSON before ready: ${line.slice(0, 120)}`), { code: 'background_input_unavailable' }))
            }
            continue
          }
          if (!ready && parsed && parsed.ready === true) {
            ready = true
            finishReady(true)
            continue
          }
          if (!inflight) continue
          const item = inflight
          inflight = null
          clearTimeout(item.timer)
          item.resolve(parsed && typeof parsed === 'object' ? parsed : errorObject('background_input_bad_response', 'non-object response'))
          armIdle()
          pump()
        }
      })
      proc.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-800) })
      proc.on('error', (err) => {
        const detail = stderrTail ? `: ${stderrTail.slice(0, 300)}` : ''
        resetChild(`background input helper failed to start${detail}`, 'background_input_unavailable')
        finishReady(false, Object.assign(new Error(`background input helper failed to start${detail}${err?.message ? ` (${err.message})` : ''}`), { code: 'background_input_unavailable' }))
      })
      proc.on('exit', (code, signal) => {
        const detail = stderrTail ? `: ${stderrTail.slice(0, 300)}` : ''
        resetChild(`background input helper exited (code=${code ?? 'null'} signal=${signal ?? 'null'})${detail}`, 'background_input_helper_exited')
        finishReady(false, Object.assign(new Error(`background input helper exited (code=${code ?? 'null'})`), { code: 'background_input_helper_exited' }))
      })
    })
    return starting
  }

  function pump() {
    if (inflight || queue.length === 0) return
    startChild().then((ok) => {
      if (!ok || !child || !ready || inflight || queue.length === 0) return
      const item = queue.shift()
      inflight = item
      item.timer = setTimeout(() => {
        if (inflight !== item) return
        inflight = null
        item.reject(Object.assign(new Error(`background input helper timeout after ${item.timeoutMs}ms`), { code: 'background_input_timeout' }))
        try { child.stdin.end() } catch { /* ignore */ }
        try { child.kill() } catch { /* ignore */ }
        resetChild('background input helper timeout', 'background_input_timeout')
        pump()
      }, item.timeoutMs)
      try {
        child.stdin.write(`${JSON.stringify(item.req)}\n`)
      } catch (err) {
        clearTimeout(item.timer)
        inflight = null
        item.reject(Object.assign(err instanceof Error ? err : new Error(String(err)), { code: 'background_input_failed' }))
        pump()
      }
    }).catch((err) => {
      const item = queue.shift()
      if (item) item.reject(err)
      pump()
    })
  }

  function request(cmd, payload = {}, timeoutMs = 5000) {
    if (!available) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      queue.push({ req: { cmd, ...payload }, resolve, reject, timeoutMs, timer: null })
      pump()
    }).catch((err) => errorObject(err?.code || 'background_input_failed', err?.message || err))
  }

  async function stop() {
    if (!available) return
    if (child) {
      await request('restore', {}, 1500).catch(() => null)
      await request('shutdown', {}, 500).catch(() => null)
    }
    resetChild('background input helper stopped', 'background_input_helper_exited')
  }

  return {
    available,
    request,
    stop,
    probe: (payload, opts = {}) => request('probe', payload, opts.timeoutMs || 2500),
    postMouse: (payload, opts = {}) => request('postMouse', payload, opts.timeoutMs || 5000),
    postKey: (payload, opts = {}) => request('postKey', payload, opts.timeoutMs || 5000),
    postText: (payload, opts = {}) => request('postText', payload, opts.timeoutMs || 5000),
    syntheticClick: (payload, opts = {}) => request('syntheticClick', payload, opts.timeoutMs || 8000),
    cursorClick: (payload, opts = {}) => request('cursorClick', payload, opts.timeoutMs || 8000),
    windowClick: (payload, opts = {}) => request('windowClick', payload, opts.timeoutMs || 8000),
  }
}

const defaultClient = createBackgroundInputClient()
const profileCache = new Map()

/** 三键全 off → 不 spawn、不改行为。 */
export function hasExperimentalInput(cfg) {
  return Boolean(cfg)
    && (cfg.backgroundInput === 'auto'
      || cfg.syntheticPointer === 'auto'
      || (cfg.anchoredInput && cfg.anchoredInput !== 'off'))
}

export function clearProfileCache() {
  profileCache.clear()
}

function normalizeProfile(raw) {
  if (!raw || raw.ok !== true) return null
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const rect = (r) => ({
    left: num(r?.left),
    top: num(r?.top),
    right: num(r?.right),
    bottom: num(r?.bottom),
    width: num(r?.width, num(r?.right) - num(r?.left)),
    height: num(r?.height, num(r?.bottom) - num(r?.top)),
  })
  return {
    hwnd: num(raw.hwnd),
    pid: num(raw.pid),
    className: String(raw.className || ''),
    processImage: String(raw.processImage || ''),
    integrity: String(raw.integrity || 'unknown'),
    integrityRank: num(raw.integrityRank),
    currentIntegrityRank: num(raw.currentIntegrityRank),
    sameSession: raw.sameSession !== false,
    secureDesktop: raw.secureDesktop === true,
    visible: raw.visible !== false,
    iconic: raw.iconic === true,
    zoomed: raw.zoomed === true,
    foreground: raw.foreground === true,
    touchWindow: raw.touchWindow === true,
    focusHwnd: num(raw.focusHwnd),
    windowRect: rect(raw.windowRect),
    clientRect: rect(raw.clientRect),
    clientOrigin: { x: num(raw.clientOrigin?.x), y: num(raw.clientOrigin?.y) },
    cursor: { x: num(raw.cursor?.x), y: num(raw.cursor?.y) },
    clipCursor: rect(raw.clipCursor),
    virtualScreen: rect(raw.virtualScreen),
  }
}

export async function probeTarget(target, client = defaultClient) {
  if (!target || target.pid == null || target.windowId == null) return null
  if (!client?.available) return null
  const key = `${target.pid}:${target.windowId}`
  const now = Date.now()
  const cached = profileCache.get(key)
  if (cached && now - cached.at < PROFILE_TTL_MS) return cached.profile
  const raw = await client.probe({ hwnd: Number(target.windowId), pid: Number(target.pid) }).catch(() => null)
  const profile = normalizeProfile(raw)
  if (!profile) return null
  profileCache.set(key, { at: now, profile })
  return profile
}

/**
 * 目标契约分类。只对无 UIA 元素的快照调用。
 * uia/native-dialog/unknown/secure/uipi/unavailable 都表示插件通道不接管。
 */
export function classifyTarget({ snap, profile }) {
  if (!snap) return 'unknown'
  if (snap.backend === 'native-dialog') return 'native-dialog'
  if (!hasNoActionableUia(snap)) return 'uia'
  if (!profile) return 'unknown'
  if (profile.secureDesktop) return 'secure'
  if (profile.sameSession === false) return 'uipi'
  if (Number(profile.integrityRank) > Number(profile.currentIntegrityRank)) return 'uipi'
  if (profile.iconic || profile.visible === false) return 'unavailable'
  if (profile.touchWindow || POINTER_CLASSES.has(profile.className)) return 'pointer'
  return 'message'
}

/**
 * 快照里没有可交互 UIA 元素时才允许插件通道。
 * elementCount 可能是 0（游戏/Canvas），也可能只有窗口/Pane 根元素；
 * 只要 entries 中没有 Button/Edit/MenuItem 等可交互角色，就视为“无 UIA 可操作面”。
 */
function inLocalRect(x, y, rect) {
  if (!rect || !(Number(rect.w) > 0) || !(Number(rect.h) > 0)) return false
  const px = Number(x)
  const py = Number(y)
  return Number.isFinite(px) && Number.isFinite(py)
    && px >= Number(rect.x) && px < Number(rect.x) + Number(rect.w)
    && py >= Number(rect.y) && py < Number(rect.y) + Number(rect.h)
}

export function hasNoActionableUia(snap) {
  if (!snap) return false
  if (Number(snap.elementCount) === 0) return true
  const bar = snap.titleBarRect
  const barBottom = bar && Number(bar.h) > 0 ? Number(bar.y) + Number(bar.h) : null
  for (const entry of snap.entries?.values?.() || []) {
    if (!isActionableRole(entry?.role)) continue
    // 标题栏/系统菜单/关闭按钮属于非客户区；按 y 带排除，不能只看 caption 文本矩形。
    if (barBottom !== null && Number(entry?.y) < barBottom) continue
    return false
  }
  return true
}

function allowedInvasive(cfg, snap) {
  const list = Array.isArray(cfg?.allowedApps) ? cfg.allowedApps : []
  return list.length > 0 && Boolean(snap?.appName) && list.includes(snap.appName)
}

/** 快照坐标（窗口截图空间）→ 屏幕物理像素；复用私有拖拽的 scale 规则。 */
export function screenPointOfTarget(target, snap) {
  if (!target || target.fromZoom) return null
  const x = Number(target.x)
  const y = Number(target.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const org = snap?.screenOrigin
  if (!org) return null
  const sw = Number(snap?.screenshotWidth)
  const sh = Number(snap?.screenshotHeight)
  const bw = Number(org?.width)
  const bh = Number(org?.height)
  if (sw > 0 && sh > 0 && bw > 0 && bh > 0) {
    return {
      x: Math.round(Number(org.x) + x * (bw / sw)),
      y: Math.round(Number(org.y) + y * (bh / sh)),
    }
  }
  // ax 快照没有截图尺寸；驱动/元素的本地坐标与 screenOrigin 同为窗口物理空间，1:1 映射。
  return { x: Math.round(Number(org.x) + x), y: Math.round(Number(org.y) + y) }
}

const VK_ALIASES = new Map([
  ['return', 0x0D], ['enter', 0x0D], ['esc', 0x1B], ['escape', 0x1B],
  ['tab', 0x09], ['space', 0x20], ['backspace', 0x08], ['back', 0x08],
  ['delete', 0x2E], ['del', 0x2E], ['insert', 0x2D], ['ins', 0x2D],
  ['left', 0x25], ['right', 0x27], ['up', 0x26], ['down', 0x28],
  ['home', 0x24], ['end', 0x23],
  ['pageup', 0x21], ['pgup', 0x21], ['pagedown', 0x22], ['pgdn', 0x22],
  ['page_up', 0x21], ['page_down', 0x22],
])
for (let i = 1; i <= 12; i += 1) VK_ALIASES.set(`f${i}`, 0x6F + i)

const EXTENDED_VKS = new Set([
  0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E,
])

/** 普通键名 → {vk, extended}；组合键/未知键返回 null（交回 driver）。 */
export function virtualKeyOf(keyName) {
  const raw = String(keyName || '').trim().toLowerCase()
  if (!raw) return null
  if (VK_ALIASES.has(raw)) {
    const vk = VK_ALIASES.get(raw)
    return { vk, extended: EXTENDED_VKS.has(vk) }
  }
  if (/^[a-z]$/.test(raw)) return { vk: raw.toUpperCase().charCodeAt(0), extended: false }
  if (/^[0-9]$/.test(raw)) return { vk: raw.charCodeAt(0), extended: false }
  return null
}

function refusalValue(raw, mode, level) {
  const code = canonicalCode(raw?.code)
  return {
    ok: false,
    code,
    error: String(raw?.error ? `${code}: ${raw.error}` : (REFUSAL_TEXT[code] || REFUSAL_TEXT.background_input_failed)),
    delivery: { mode },
    route: 'plugin-background-input',
    background_level: level,
    delivered: raw?.delivered === true,
    side_effects: raw?.side_effects && typeof raw.side_effects === 'object' ? raw.side_effects : {},
  }
}

function refusalNote(code) {
  return REFUSAL_TEXT[code] || REFUSAL_TEXT.background_input_failed
}

const PRE_DELIVERY_NULL_CODES = new Set([
  'window_not_found', 'pid_mismatch', 'not_supported', 'not_applicable', 'no_focus',
])

const HELPER_CODE_MAP = {
  occluded: 'background_input_occluded',
  anchor_blocked: 'background_input_anchor_blocked',
  uipi: 'background_input_uipi',
  secure_desktop: 'background_input_secure_desktop',
  clip_cursor: 'background_input_clip_cursor',
  window_not_movable: 'background_input_window_not_movable',
  window_move_failed: 'background_input_window_move_failed',
  cursor_changed: 'background_input_cursor_changed',
  password_denied: 'background_input_password_denied',
  synthetic_timeout: 'background_input_timeout',
  synthetic_unavailable: 'background_input_failed',
  synthetic_failed: 'background_input_failed',
  injection_failed: 'background_input_failed',
  post_failed: 'background_input_failed',
  send_failed: 'background_input_failed',
  block_input_failed: 'background_input_failed',
  cursor_move_failed: 'background_input_failed',
  cursor_failed: 'background_input_failed',
  outside_desktop: 'background_input_occluded',
}

function canonicalCode(code) {
  return HELPER_CODE_MAP[String(code || '')] || String(code || 'background_input_failed')
}

function isPreDeliveryNull(raw) {
  return raw && raw.delivered === false && PRE_DELIVERY_NULL_CODES.has(String(raw.code || ''))
}

function clickSuccess(raw, mode, level) {
  const confirmed = raw?.effect === 'confirmed'
  return {
    ok: true,
    effect: confirmed ? 'confirmed' : 'unverifiable',
    delivery: { mode },
    route: 'plugin-background-input',
    background_level: level,
    method: String(raw?.method || ''),
    child_class: raw?.childClass ? String(raw.childClass) : undefined,
    child_hwnd: raw?.childHwnd ? Number(raw.childHwnd) : undefined,
    anchor_used: raw?.anchorUsed === true || undefined,
    side_effects: raw?.side_effects && typeof raw.side_effects === 'object' ? raw.side_effects : {},
  }
}

function mapClick(raw, mode, level) {
  if (!raw) return null
  if (raw.ok !== true) {
    if (isPreDeliveryNull(raw)) return null
    return {
      value: refusalValue(raw, mode, level),
      note: '',
      refusalNote: refusalNote(canonicalCode(raw.code)),
    }
  }
  const value = clickSuccess(raw, mode, level)
  let note = ''
  if (mode === 'background-message') note = '（B0 后台消息：WM_* 已投递；未移动光标/前台；应用是否处理未验证。）'
  else if (mode === 'win32-control') note = '（B0 控件消息：BM_CLICK 已投递；未移动光标/前台；业务效果未验证。）'
  else if (mode === 'synthetic-pointer') note = '（B1 合成触控：WM_POINTER 已注入；未移动光标/前台；应用是否处理未验证。）'
  else if (mode === 'cursor-anchored') {
    const ms = Number(raw?.inputBlockedMs) || 0
    note = `（B2 光标锚定：光标已临时移动${raw?.cursorRestored === false ? '，但还原失败，请检查光标位置' : '并还原'}；用户输入阻塞约 ${ms}ms。）`
  } else if (mode === 'window-anchored') {
    note = `（B3 窗口锚定：窗口已临时移动${raw?.windowRestored === false ? '，但还原失败，请手动恢复窗口位置' : '并还原'}；光标未移动。）`
  }
  const unverifiedNote = UNVERIFIED_BY_MODE[mode] || ''
  return { value, note, preNote: '', unverifiedNote, refusalNote: '' }
}

function typeSuccess(raw) {
  const verified = raw?.verified === true
  const method = String(raw?.method || 'wm_char')
  const mode = method === 'wm_settext' || method === 'em_replacesel' ? 'win32-control' : 'background-message'
  return {
    value: {
      ok: true,
      effect: verified ? 'confirmed' : 'unverifiable',
      delivery: { mode },
      route: 'plugin-background-input',
      background_level: 'B0',
      method,
      verified,
      focused_hwnd: raw?.focusedHwnd ? Number(raw.focusedHwnd) : undefined,
      side_effects: raw?.side_effects && typeof raw.side_effects === 'object' ? raw.side_effects : {},
    },
    note: `（B0 文本：${method} 已投递；${verified ? '回读一致' : '未验证'}；先观察/回读，不要重复输入同一段文本。）`,
    unverifiedNote: '',
  }
}

function mapType(raw) {
  if (!raw) return null
  if (raw.ok !== true) {
    if (isPreDeliveryNull(raw)) return null
    return { value: refusalValue(raw, 'background-message', 'B0'), note: '', refusalNote: refusalNote(canonicalCode(raw.code)) }
  }
  return typeSuccess(raw)
}

function mapKey(raw) {
  if (!raw) return null
  if (raw.ok !== true) {
    if (isPreDeliveryNull(raw)) return null
    return { value: refusalValue(raw, 'background-message', 'B0'), note: '', refusalNote: refusalNote(canonicalCode(raw.code)) }
  }
  return {
    value: {
      ok: true,
      effect: 'unverifiable',
      delivery: { mode: 'background-message' },
      route: 'plugin-background-input',
      background_level: 'B0',
      method: 'wm_key',
      focused_hwnd: raw?.focusedHwnd ? Number(raw.focusedHwnd) : undefined,
      side_effects: raw?.side_effects && typeof raw.side_effects === 'object' ? raw.side_effects : {},
    },
    note: '（B0 按键：WM_KEYDOWN/UP 已投递；未移动光标/前台；应用是否处理未验证。）',
    unverifiedNote: '',
  }
}

function clickEligible({ tool, snap, args, cfg, extra }) {
  if (!hasExperimentalInput(cfg) || !snap || args?.from_zoom === true) return false
  if (cfg.deliveryMode === 'foreground' || args?.foreground === true) return false
  if (Array.isArray(extra?.modifier) && extra.modifier.length > 0) return false
  if (snap.backend === 'native-dialog' || !hasNoActionableUia(snap)) return false
  if (!['click', 'double_click', 'right_click'].includes(tool)) return false
  const count = Number(extra?.count ?? 1)
  if (tool === 'click' && count !== 1) return false
  if (tool === 'double_click' && count !== 2) return false
  return true
}

/**
 * 点击路由。返回 null = 不接管（交回 driver）；返回 {value,...} = 已投递/已拒绝。
 * 顺序：显式 B1 → 显式 B2/B3 → B0；B1 遮挡失败不降级到 B2/B3。
 */
export async function tryBackgroundClick({ tool, target, snap, args, cfg, extra = {}, client = defaultClient }) {
  if (!clickEligible({ tool, snap, args, cfg, extra })) return null
  const profile = await probeTarget(target, client)
  if (!profile) return null
  const contract = classifyTarget({ snap, profile })
  if (['uia', 'native-dialog', 'unknown', 'secure', 'uipi', 'unavailable'].includes(contract)) return null
  const point = screenPointOfTarget(target, snap)
  if (!point) return null
  const invasive = allowedInvasive(cfg, snap)
  const count = Number(extra?.count ?? 1)
  const button = tool === 'right_click' ? 'right' : 'left'
  const leftSingle = tool === 'click' && count === 1 && button === 'left'

  // B1：显式开启合成触控，目标为 pointer 契约（或显式 allowedApps + touchWindow）。
  if (cfg.syntheticPointer === 'auto' && invasive && leftSingle
    && (contract === 'pointer' || profile.touchWindow)) {
    const raw = await client.syntheticClick({ hwnd: Number(target.windowId), pid: Number(target.pid), x: point.x, y: point.y })
    return mapClick(raw, 'synthetic-pointer', 'B1')
  }

  // B2/B3：显式锚定；只支持单次左键。用户显式配置优先于 B0。
  if (leftSingle && invasive) {
    if (cfg.anchoredInput === 'cursor') {
      const raw = await client.cursorClick({ hwnd: Number(target.windowId), pid: Number(target.pid), x: point.x, y: point.y })
      return mapClick(raw, 'cursor-anchored', 'B2')
    }
    if (cfg.anchoredInput === 'window') {
      const raw = await client.windowClick({
        hwnd: Number(target.windowId), pid: Number(target.pid),
        clientX: Number(target.x), clientY: Number(target.y),
      })
      return mapClick(raw, 'window-anchored', 'B3')
    }
  }

  // B0：只对 message 契约；B1/B2/B3 未配置时。
  if (cfg.backgroundInput === 'auto' && contract === 'message') {
    const raw = await client.postMouse({
      hwnd: Number(target.windowId), pid: Number(target.pid),
      x: point.x, y: point.y, button, count: button === 'right' ? 1 : count,
    })
    return mapClick(raw, 'background-message', 'B0')
  }
  return null
}

/**
 * 文本路由（B0 only）：仅无 UIA 的快照；组合键/前台/from_zoom 不接管。
 * 返回 null = 交回 driver。
 */
export async function tryBackgroundType({ args, snap, cfg, elementIndex = null, target = null, client = defaultClient }) {
  if (cfg?.backgroundInput !== 'auto' || !snap || !hasNoActionableUia(snap)) return null
  if (args?.foreground === true || cfg.deliveryMode === 'foreground' || args?.from_zoom === true) return null
  const text = String(args?.text ?? '')
  if (!text) return null
  const pid = Number(target?.pid ?? snap.pid)
  const hwnd = Number(target?.windowId ?? snap.windowId)
  if (!Number.isFinite(pid) || !Number.isFinite(hwnd)) return null
  const profile = await probeTarget({ pid, windowId: hwnd }, client)
  if (!profile) return null
  const contract = classifyTarget({ snap, profile })
  if (['uia', 'native-dialog', 'unknown', 'secure', 'uipi', 'unavailable'].includes(contract)) return null
  let point = null
  if (elementIndex !== null && elementIndex !== undefined) {
    const entry = snap.entries?.get(Number(elementIndex))
    if (entry) point = screenPointOfTarget({ x: entry.x, y: entry.y }, snap)
  }
  const raw = await client.postText({
    hwnd, pid,
    hasPoint: Boolean(point), x: point?.x ?? 0, y: point?.y ?? 0,
    textB64: Buffer.from(text, 'utf8').toString('base64'),
    append: true,
  })
  return mapType(raw)
}

/**
 * 普通按键路由（B0 only）：组合键一律不接管（继续前台规则）。
 */
export async function tryBackgroundKey({ args, snap, cfg, target = null, client = defaultClient }) {
  if (cfg?.backgroundInput !== 'auto' || !snap || !hasNoActionableUia(snap)) return null
  if (args?.foreground === true || cfg.deliveryMode === 'foreground') return null
  const keyName = String(args?.key ?? '').trim()
  if (!keyName || keyName.includes('+')) return null
  const vk = virtualKeyOf(keyName)
  if (!vk) return null
  const pid = Number(target?.pid ?? snap.pid)
  const hwnd = Number(target?.windowId ?? snap.windowId)
  if (!Number.isFinite(pid) || !Number.isFinite(hwnd)) return null
  const profile = await probeTarget({ pid, windowId: hwnd }, client)
  if (!profile) return null
  const contract = classifyTarget({ snap, profile })
  if (['uia', 'native-dialog', 'unknown', 'secure', 'uipi', 'unavailable'].includes(contract)) return null
  const raw = await client.postKey({ hwnd, pid, vk: vk.vk, extended: vk.extended })
  return mapKey(raw)
}

/** 停止 helper；computer_stop / 插件重载时调用。 */
export async function stopBackgroundInput() {
  clearProfileCache()
  await defaultClient.stop()
}

/** 同步重载入口：不等待，但清理缓存并尽力结束 helper。 */
export function resetBackgroundInput() {
  clearProfileCache()
  void defaultClient.stop().catch(() => undefined)
}
