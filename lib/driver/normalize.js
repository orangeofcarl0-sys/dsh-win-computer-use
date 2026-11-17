/**
 * driver/normalize.js —— cua-driver 响应 → 插件内部规范形态。
 *
 * 内部形态刻意沿用 0.23.2 的字段名（window/elements/frame/...），这样
 * observe/actions/human/ops/keyFallback 不需要改读取点；但字段从此由本模块
 * **拥有**，不再等于“某个驱动版本恰好返回什么”。
 *
 * 规则：
 * 1. 保留未知字段（{...raw, ...canonical}），previous_fg_hwnd/route/capture_id 等不丢；
 * 2. 同时接受新旧形态（window/window_bounds、frame/screenshot_frame、w/width）；
 * 3. 不伪造成功：只做字段归一，负向词汇由 engine/cua 判定；
 * 4. 纯函数：不 spawn、不读环境，便于 fixtures 单测。
 */

const ACTION_TOOLS = new Set([
  'click', 'drag', 'type_text', 'set_value', 'press_key', 'hotkey', 'scroll',
  'move_cursor', 'bring_to_front', 'invoke_menu', 'start_session', 'end_session',
  'set_agent_cursor_theme',
])

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 统一矩形：接受 {x,y,w,h} 与 {x,y,width,height}，输出同时带两套字段。 */
export function rectOf(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const x = num(v.x)
  const y = num(v.y)
  const w = num(v.w ?? v.width)
  const h = num(v.h ?? v.height)
  if (x === null || y === null || w === null || h === null) return null
  return { x, y, w, h, width: w, height: h }
}

/** 窗口矩形：只保留 width/height 命名（screenOriginOf 读这两个）。 */
export function boundsOf(v) {
  const r = rectOf(v)
  if (!r) return null
  return { x: r.x, y: r.y, width: r.w, height: r.h, w: r.w, h: r.h }
}

function mimeFromFormat(format) {
  const f = String(format || '').toLowerCase()
  if (f === 'png') return 'image/png'
  if (f === 'jpeg' || f === 'jpg') return 'image/jpeg'
  if (f === 'webp') return 'image/webp'
  if (f === 'gif') return 'image/gif'
  return null
}

/**
 * 解包 MCP content[] / 文本 JSON。CLI `call` 通常直接输出 structuredContent；
 * 但 MCP 直连或未来 CLI 形态可能给 content[]，这里统一收口。
 * - text 块：若整体是 JSON 对象则解析；否则保留原字符串；
 * - image 块：补 screenshot_png_b64 / screenshot_mime_type。
 */
export function unwrapDriverPayload(value) {
  if (typeof value === 'string') {
    const s = value.trim()
    if (s.startsWith('{') || s.startsWith('[')) {
      try { return JSON.parse(s) } catch { return value }
    }
    return value
  }
  if (!value || typeof value !== 'object' || !Array.isArray(value.content)) return value
  const texts = value.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
  const image = value.content.find((b) => b && b.type === 'image' && typeof b.data === 'string')
  let out = { ...value }
  delete out.content
  if (image) {
    out.screenshot_png_b64 = out.screenshot_png_b64 || image.data
    out.screenshot_mime_type = out.screenshot_mime_type || image.mimeType || image.mime_type || 'image/png'
  }
  if (texts.length > 0) {
    const joined = texts.join('\n')
    try {
      const parsed = JSON.parse(joined)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...parsed, ...out }
      }
    } catch { /* 非 JSON 文本，保留 */ }
    if (Object.keys(out).length === (image ? 2 : 0)) return joined
    out.text = out.text ?? joined
  }
  return out
}

/** 屏幕矩形 → 截图矩形（截图与窗口 bounds 可能差 1–2px）。 */
function toScreenshotRect(frame, bounds, sw, sh) {
  if (!frame || !bounds || !(sw > 0) || !(sh > 0)) return null
  const kx = sw / bounds.width
  const ky = sh / bounds.height
  return {
    x: (frame.x - bounds.x) * kx,
    y: (frame.y - bounds.y) * ky,
    w: frame.w * kx,
    h: frame.h * ky,
    width: frame.w * kx,
    height: frame.h * ky,
  }
}

/** 截图矩形 → 屏幕矩形。 */
function toScreenRect(shot, bounds, sw, sh) {
  if (!shot || !bounds || !(sw > 0) || !(sh > 0)) return null
  const kx = bounds.width / sw
  const ky = bounds.height / sh
  return {
    x: bounds.x + shot.x * kx,
    y: bounds.y + shot.y * ky,
    w: shot.w * kx,
    h: shot.h * ky,
    width: shot.w * kx,
    height: shot.h * ky,
  }
}

/**
 * 元素归一化：element_index/token、frame/screenshot_frame、w/width。
 * frame 统一成**屏幕物理像素**（centerOf/密码扫描/去重依赖它）；
 * screenshot_frame 保留/补算成截图空间（observe 的缩放感知映射优先用它）。
 */
export function normalizeElement(raw, { bounds = null, screenshotWidth = null, screenshotHeight = null, frameSpace = null } = {}) {
  if (!raw || typeof raw !== 'object') return raw
  const out = { ...raw }
  const idx = num(raw.element_index ?? raw.index)
  if (idx !== null) out.element_index = idx
  const token = raw.element_token ?? raw.token
  if (token !== undefined) out.element_token = token

  let frame = rectOf(raw.frame)
  let shot = rectOf(raw.screenshot_frame ?? raw.screenshotFrame)
  const sw = num(screenshotWidth)
  const sh = num(screenshotHeight)

  if (frameSpace === 'screenshot' && frame) {
    // 校准结果显示 frame 也是截图空间：以 screenshot_frame（若有）为准转屏幕。
    const src = shot || frame
    frame = toScreenRect(src, bounds, sw, sh) || frame
  }
  if (!frame && shot) {
    frame = toScreenRect(shot, bounds, sw, sh) || null
    if (!frame) out.frame_space = 'screenshot-unmapped'
  }
  if (frame && !shot) {
    shot = toScreenshotRect(frame, bounds, sw, sh)
  }
  if (frame) out.frame = frame
  if (shot) out.screenshot_frame = shot
  if (raw.frame_space && !out.frame_space) out.frame_space = raw.frame_space

  if (raw.is_password === undefined && raw.isPassword !== undefined) out.is_password = Boolean(raw.isPassword)
  if (raw.value === undefined) out.value = ''
  return out
}

/**
 * get_window_state 归一化。
 * 0.23.2 没有 window 对象；0.53 用顶层 window_bounds/window_title/app_name。
 * 两种情况都合成 window，刷新路径就能拿到新标题/新原点。
 */
export function normalizeWindowState(raw, caps = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out = { ...raw }
  const bounds = boundsOf(raw.window_bounds)
    || boundsOf(raw.bounds)
    || boundsOf(raw.window?.bounds)
  const title = raw.window_title ?? raw.window?.title ?? raw.title ?? ''
  const appName = raw.app_name ?? raw.window?.app_name ?? raw.window?.app ?? raw.app ?? ''
  const pid = raw.pid ?? raw.window?.pid
  const windowId = raw.window_id ?? raw.window?.window_id
  out.window = {
    ...(raw.window && typeof raw.window === 'object' ? raw.window : {}),
    title,
    bounds: bounds || raw.window?.bounds || null,
    app_name: appName,
    pid,
    window_id: windowId,
  }
  if (bounds) out.window_bounds = bounds
  if (title) out.window_title = title
  if (appName) out.app_name = appName

  const screenshotWidth = num(raw.screenshot_width)
  const screenshotHeight = num(raw.screenshot_height)
  const elements = Array.isArray(raw.elements) ? raw.elements : []
  out.elements = elements.map((e) => normalizeElement(e, {
    bounds,
    screenshotWidth,
    screenshotHeight,
    frameSpace: caps.frameSpace ?? null,
  }))
  out.element_count = num(raw.element_count) ?? out.elements.length
  out.total_element_count = num(raw.total_element_count) ?? out.element_count
  out.snapshot_id = raw.snapshot_id ?? raw.snapshotId ?? null
  out.screenshot_mime_type = raw.screenshot_mime_type
    ?? raw.screenshotMimeType
    ?? mimeFromFormat(raw.format)
    ?? 'image/png'
  if (!out.screenshot_png_b64 && typeof raw.screenshot_b64 === 'string') {
    out.screenshot_png_b64 = raw.screenshot_b64
  }
  out.degraded_reason = raw.degraded_reason ?? raw.degradedReason ?? null
  if (!out.frame_space) {
    out.frame_space = out.elements.find((e) => e && e.frame_space)?.frame_space
      || caps.frameSpace
      || (out.elements.some((e) => e && e.screenshot_frame) ? 'screenshot' : 'screen')
  }
  return out
}

/** get_desktop_state 归一化：只统一截图字段。 */
export function normalizeDesktopState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out = { ...raw }
  out.screenshot_width = num(raw.screenshot_width) ?? 0
  out.screenshot_height = num(raw.screenshot_height) ?? 0
  out.screenshot_mime_type = raw.screenshot_mime_type
    ?? raw.screenshotMimeType
    ?? mimeFromFormat(raw.format)
    ?? 'image/png'
  if (!out.screenshot_png_b64 && typeof raw.screenshot_b64 === 'string') {
    out.screenshot_png_b64 = raw.screenshot_b64
  }
  return out
}

/** list_windows 归一化：windows[]/裸数组、bounds、app_name、minimized。 */
export function normalizeWindowList(raw) {
  const arr = Array.isArray(raw) ? raw : (raw?.windows || raw?._legacy_windows || [])
  const windows = (Array.isArray(arr) ? arr : []).map((w) => {
    if (!w || typeof w !== 'object') return w
    const out = { ...w }
    const bounds = boundsOf(w.bounds)
      || (num(w.x) !== null && num(w.y) !== null ? boundsOf(w) : null)
    if (bounds) out.bounds = bounds
    out.window_id = w.window_id ?? w.windowId
    out.pid = w.pid
    out.title = w.title ?? ''
    out.app_name = w.app_name ?? w.app ?? ''
    out.z_index = w.z_index ?? w.zIndex ?? null
    out.is_on_screen = w.is_on_screen !== false
    out.minimized = Boolean(w.minimized ?? w.is_minimized ?? w.isMinimized ?? false)
    return out
  })
  if (Array.isArray(raw)) return { windows }
  return { ...raw, windows }
}

/** zoom 归一化：mime/format、宽高、截图字段。 */
export function normalizeZoom(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out = { ...raw }
  out.width = num(raw.width) ?? num(raw.image_width) ?? null
  out.height = num(raw.height) ?? num(raw.image_height) ?? null
  const mime = raw.mime_type ?? raw.screenshot_mime_type ?? raw.mime ?? mimeFromFormat(raw.format)
  if (mime) out.mime_type = mime
  if (mime) out.screenshot_mime_type = mime
  if (!out.screenshot_png_b64) {
    out.screenshot_png_b64 = raw.screenshot_b64 ?? raw.image_b64 ?? raw.image?.data ?? null
  }
  return out
}

/** check_permissions 归一化：post_message/postmessage 两套拼写。 */
export function normalizePermissions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out = { ...raw }
  out.elevated = raw.elevated === true
  out.integrity_level = raw.integrity_level ?? raw.integrityLevel ?? null
  out.uia = raw.uia ?? null
  out.post_message = raw.post_message ?? raw.postmessage ?? false
  out.postmessage = out.post_message
  return out
}

/** clipboard_read 归一化：text/plain_text/content。 */
export function normalizeClipboard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out = { ...raw }
  const text = raw.text ?? raw.plain_text ?? raw.plainText
    ?? (typeof raw.content === 'string' ? raw.content : undefined)
  if (text !== undefined) out.text = text
  return out
}

/** verify_state 归一化：predicates[] 或 satisfied:boolean。 */
export function normalizeVerify(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out = { ...raw }
  if (!Array.isArray(out.predicates) && typeof raw.satisfied === 'boolean') {
    out.predicates = [{
      index: 0,
      status: raw.satisfied ? 'satisfied' : 'unsatisfied',
      unknown_reason: raw.satisfied ? null : (raw.reason || raw.message || null),
      observed_json: raw.observed_json ?? raw.observed ?? null,
    }]
    out.status = out.status ?? (raw.satisfied ? 'satisfied' : 'unsatisfied')
    out.stable = out.stable ?? true
  }
  return out
}

/** list_apps / launch_app 归一化：running、active、windows 的 minimized。 */
export function normalizeApps(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out = { ...raw }
  const apps = Array.isArray(raw.apps) ? raw.apps : []
  out.apps = apps.map((a) => {
    if (!a || typeof a !== 'object') return a
    return {
      ...a,
      running: a.running ?? a.is_running,
      active: a.active ?? a.is_active,
      name: a.name ?? a.app_name ?? '',
    }
  })
  return out
}

export function normalizeLaunch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out = { ...raw }
  out.running = raw.running ?? raw.is_running
  const windows = Array.isArray(raw.windows) ? raw.windows : []
  out.windows = windows.map((w) => {
    if (!w || typeof w !== 'object') return w
    const o = { ...w }
    const bounds = boundsOf(w.bounds)
    if (bounds) o.bounds = bounds
    o.is_on_screen = w.is_on_screen !== false
    o.minimized = Boolean(w.minimized ?? w.is_minimized ?? w.isMinimized ?? false)
    return o
  })
  return out
}

/** 动作回执归一化：delivery 对象/字符串、verified:false → unverifiable。 */
export function normalizeReceipt(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out = { ...raw }
  if (typeof raw.delivery === 'string') out.delivery = { mode: raw.delivery }
  if (!out.delivery && typeof raw.delivery_mode === 'string') out.delivery = { mode: raw.delivery_mode }
  if (raw.verified === false && raw.effect === undefined && raw.ok !== false
    && !raw.refusal && !raw.error && raw.supported !== false) {
    out.effect = 'unverifiable'
  }
  return out
}

/**
 * 工具分派。未识别的工具只解包、不猜测。
 * @param {string} tool
 * @param {any} value
 * @param {object} caps
 */
export function normalizeResponse(tool, value, caps = {}) {
  const v = unwrapDriverPayload(value)
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v
  switch (tool) {
    case 'get_window_state': return normalizeWindowState(v, caps)
    case 'get_desktop_state': return normalizeDesktopState(v)
    case 'list_windows': return normalizeWindowList(v)
    case 'zoom': return normalizeZoom(v)
    case 'check_permissions': return normalizePermissions(v)
    case 'clipboard_read': return normalizeClipboard(v)
    case 'verify_state': return normalizeVerify(v)
    case 'list_apps': return normalizeApps(v)
    case 'launch_app': return { ...normalizeReceipt(v), ...normalizeLaunch(v) }
    case 'get_cursor_position': return v
    default:
      return ACTION_TOOLS.has(tool) ? normalizeReceipt(v) : v
  }
}
