/**
 * cua.js —— cua-driver 引擎调用封装（facade）。
 *
 * 物理调用与响应归一化已下沉到 lib/driver/：
 *   - driver/transport.js  唯一 spawn + 超时/退出码/非 JSON/contract 分类
 *   - driver/capabilities.js 版本/能力/请求形态/自适应学习
 *   - driver/normalize.js  响应 → 插件内部规范形态
 *   - driver/info.js       驱动信息缓存/诊断
 *
 * 本文件保留原有导出面（CUA_BIN/CUA_SESSION/withSession/cuaCall/cuaDeliver/
 * 分类函数/normalizeMcp），因此 actions/observe/human/ops/keyFallback 不需要改。
 * cuaCall 是唯一的驱动 I/O 收口：请求映射 → transport → 归一化 → 学习。
 */
import { engineRefusal } from './engine.js'
import { pidOfWindow, rememberWindows } from './windowMap.js'
import {
  defaultTransport, resolveBin, isSessionEndedText,
} from './driver/transport.js'
import {
  mapRequest, learnFromResponse, learnFromError,
} from './driver/capabilities.js'
import { normalizeResponse } from './driver/normalize.js'
import { ensureDriverInfo, resetDriverInfo, configureDriver, driverStatusLine } from './driver/info.js'

/** 驱动二进制路径（模块加载时解析一次）。 */
export const CUA_BIN = resolveBin()

/**
 * 插件统一的虚拟光标会话 id：所有动作绑定同一会话，
 * 光标主题/运动参数才能稳定生效（会话级）。
 */
export const CUA_SESSION = process.env.CUA_SESSION || 'dsh-win-computer-use'

/** 给动作类调用注入统一会话（观察类只读工具不需要）。 */
export function withSession(args = {}) {
  return { session: CUA_SESSION, ...args }
}

let activeTransport = defaultTransport

/**
 * 测试专用：注入 transport（必须提供 rawCall；可选 runOnce）。
 * 同步重置能力缓存，避免沿用上一套 fake 的能力。
 */
export function __setTransportForTests(transport) {
  activeTransport = transport || defaultTransport
  resetDriverInfo()
}

export function __resetTransportForTests() {
  activeTransport = defaultTransport
  resetDriverInfo()
}

/** apply() 用：按配置重置能力探测（auto|legacy|latest）。 */
export function configureDriverProfile(profile = 'auto') {
  configureDriver({ profile })
}

/** apply() 用：异步预热能力探测；失败不阻塞插件加载。 */
export async function cuaWarmup() {
  await ensureDriverInfo({ transport: activeTransport }).catch(() => undefined)
}

/** status/诊断用：一行驱动信息（失败也返回可读文本）。 */
export async function cuaDriverStatus() {
  const info = await ensureDriverInfo({ transport: activeTransport }).catch(() => null)
  return driverStatusLine(info)
}

/** 动作层用：读取能力对象（未知时返回保守默认，drag 会走私有 helper）。 */
export async function cuaDriverCapabilities() {
  return (await ensureDriverInfo({ transport: activeTransport })).caps
}

/**
 * 调用一个 cua-driver 工具（带会话自愈、请求映射、响应归一化）。
 * @param {string} tool - 工具名，如 'get_window_state' / 'click'
 * @param {object} args - 参数对象
 * @returns {Promise<any>} 归一化后的结果（未知字段保留）
 */
export async function cuaCall(tool, args = {}) {
  const info = await ensureDriverInfo({ transport: activeTransport })
  const caps = info.caps
  const mapped = mapRequest(tool, args, caps)
  try {
    const raw = await activeTransport.rawCall(tool, mapped)
    // 先校准（frameSpace 必须在元素转换前确定），再归一化，再取 retry 信号。
    learnFromResponse(caps, tool, raw)
    let value = normalizeResponse(tool, raw, caps)
    const learn = learnFromResponse(caps, tool, value)
    if (learn.retryTreeFormat && mapped.tree_format === undefined) {
      // 极端情况：调用方显式去掉了 tree_format，而驱动默认 markdown。只读重试一次。
      const retry = await activeTransport.rawCall(tool, { ...mapped, tree_format: 'elements' })
      learnFromResponse(caps, tool, retry)
      value = normalizeResponse(tool, retry, caps)
      learnFromResponse(caps, tool, value)
    }
    return value
  } catch (err) {
    if (tool !== 'start_session' && (err?.kind === 'session_ended' || isSessionEndedText(err?.message))) {
      await activeTransport.rawCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
      const raw = await activeTransport.rawCall(tool, mapped)
      learnFromResponse(caps, tool, raw)
      const value = normalizeResponse(tool, raw, caps)
      learnFromResponse(caps, tool, value)
      return value
    }
    // 旧驱动不认识 tree_format：学习后去掉该字段重试一次（只读观察，安全）。
    if (tool === 'get_window_state' && mapped.tree_format !== undefined
      && learnFromError(caps, tool, err)) {
      const { tree_format: _drop, ...noFormat } = mapped
      const raw = await activeTransport.rawCall(tool, noFormat)
      learnFromResponse(caps, tool, raw)
      const value = normalizeResponse(tool, raw, caps)
      learnFromResponse(caps, tool, value)
      return value
    }
    learnFromError(caps, tool, err)
    throw err
  }
}

/**
 * 结构化回执里的 code/reason 文本集合。分类优先看这些字段，
 * 避免对整段 JSON 做子串匹配（background_delivery_failed 曾被误判）。
 */
function outcomeStrings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const out = []
  for (const v of [
    value.code, value.error_code, value.refusal?.code, value.escalation?.reason,
    value.reason, value.message, value.detail,
    value.refusal?.message, value.refusal?.reason, value.status,
  ]) {
    if (typeof v === 'string' && v) out.push(v)
  }
  return out
}

function hasExactToken(strings, token) {
  const re = new RegExp(`\\b${token}\\b`, 'i')
  return strings.some((s) => re.test(s))
}

function wholeJson(value) {
  return typeof value === 'string' ? value : JSON.stringify(value || {})
}

/**
 * 是否命中"后台投递不可用"的结构化信号（driver 的 delivery_mode 契约）：
 * 目标输入栈静默丢弃后台事件（Chromium/Electron/GTK/VCL/LibreOffice 等）时，
 * driver 返回 code=background_unavailable 而非静默 no-op，等待调用方升级前台。
 */
export function isBackgroundUnavailable(value) {
  const fields = outcomeStrings(value)
  if (hasExactToken(fields, 'background_unavailable')
    || fields.some((s) => /background unavailable/i.test(s))) return true
  return /background_unavailable|background unavailable/i.test(wholeJson(value))
}

/**
 * 是否命中"前台投递前置失败"信号：driver 在准备 SendInput 前校验目标窗口
 * 前台性失败（Windows 前台锁 + daemon 非 UIAccess），未投递任何输入。
 */
export function isForegroundUnavailable(value) {
  const fields = outcomeStrings(value)
  if (hasExactToken(fields, 'foreground_unavailable')
    || fields.some((s) => /foreground unavailable/i.test(s))) return true
  return /foreground_unavailable|foreground unavailable/i.test(wholeJson(value))
}

/** 是否命中"已送达但未验证"信号（回执型结果，非拒绝）。 */
export function isUnverified(value) {
  const fields = outcomeStrings(value)
  if (value && typeof value === 'object') {
    if (value.effect === 'unverifiable') return true
    if (value.verified === false && !isBackgroundUnavailable(value) && !isForegroundUnavailable(value)) return true
  }
  if (hasExactToken(fields, 'delivery_failed')) return true
  const s = wholeJson(value)
  return /unverifiable|delivery_failed|delivery failed/i.test(s) && !/background_unavailable/i.test(s)
}

/**
 * 投递层失败分类：这类回执说明目标很可能根本没有收到输入，不能当成功。
 * - background：目标拒绝后台事件（Chromium/Electron/GTK 等）
 * - foreground：Windows 前台锁/前置校验失败，未投递
 * - delivery_failed：驱动只说投递失败（通常附 escalation.target=foreground）
 */
export function deliveryFailure(value) {
  const fields = outcomeStrings(value)
  if (isForegroundUnavailable(value)) return 'foreground'
  if (isBackgroundUnavailable(value)) return 'background'
  // 词边界是必要的：escalation.reason 可能是 background_delivery_failed
  // （建议升级前台），结构化 effect 仍为 unverifiable。只看 code/reason 字段，
  // 并用 \b 避免把“建议前台重试”误判成“未送达”（2026-11-17 t14 r1）。
  if (hasExactToken(fields, 'delivery_failed')) return 'delivery_failed'
  const s = wholeJson(value)
  if (/\bdelivery_failed\b|\bdelivery failed\b/i.test(s)) return 'delivery_failed'
  return null
}

/** 引擎错误的单行摘要（注记用，避免多行噪音）。 */
function firstLine(value) {
  if (value && typeof value === 'object') {
    for (const v of [value.escalation?.reason, value.reason, value.message,
      value.refusal?.message, value.refusal?.code, value.code]) {
      if (typeof v === 'string' && v) return v.slice(0, 120)
    }
  }
  const s = wholeJson(value)
  const m = s.match(/"reason":"([^"]{0,120})"/)
  return (m ? m[1] : s.split('\n')[0]).slice(0, 120)
}

/**
 * 带投递模式的引擎调用（三级升级链，deliveryMode='auto' 时生效）：
 *   L1 background（UIA / PostMessage，不抢焦点）；
 *   L2 foreground（驱动自带 activate→act→restore）——L1 被拒后自动重试；
 *   L3 bring_to_front（AttachThreadInput 绕 Windows 前台锁）→ L2 重试 → 恢复原前台。
 * L3 触发条件（两类）：
 *   a. L2 明确前置失败（foreground_unavailable——press_key/hotkey 类有前置校验）；
 *   b. L2 返回 unverifiable 回执且工具为指针/滚轮类（click/scroll/drag）——SendInput
 *      已进系统队列但可能打到错误前台（窗口非前台时不报错、静默打空），前置绕锁重试。
 * L3 结束后必须恢复原前台（previous_fg_hwnd 回写）。hotkey 的 XAML 先验拒绝
 * （无 UIA 加速键）不升级——重试同样会被拒绝。
 * 非 auto 模式保持两级：background / foreground（forceForeground）。
 * @returns {Promise<{value:any, note:string}>} note 为升级说明（无升级为 ''）
 */
const UNVERIFIED_ESCALATE_TOOLS = new Set(['click', 'scroll', 'drag'])

export async function cuaDeliver(tool, payload, deliveryMode, opts = {}) {
  const call = opts.call ?? cuaCall
  const force = opts.forceForeground || deliveryMode === 'foreground'
  // 强制前台指针动作先前置、只执行一次；不要走“失败后重试”，否则会点/拖两遍。
  if (force && UNVERIFIED_ESCALATE_TOOLS.has(tool) && payload.pid
    && payload.window_id !== undefined && payload.window_id !== null) {
    return preflightForegroundAction(tool, payload, call)
  }
  let value
  try {
    value = await call(tool, { ...payload, delivery_mode: force ? 'foreground' : 'background' })
  } catch (err) {
    // 驱动可能把 foreground_unavailable 以非 JSON/非零退出抛出（2026-11-15 t01
    // computer_type(element=77, foreground=true) 实测）。force 时也要把它规范化，
    // 让下面同样进入 L3；否则模型只会看到 ✗ 并重复同一动作。
    // 其它错误（尤其 XAML hotkey 的 AcceleratorKey 异常）必须继续抛出，交给
    // computer_key 的 XAML 回退分支处理。
    const msg = String(err?.message || err)
    if (!force || !/foreground_unavailable|foreground unavailable/i.test(msg)) throw err
    value = { error: msg }
  }
  // 强制前台也可能被 Windows 前台锁拒绝（尤其是另存为/覆盖确认对话框）。
  // 旧实现 force 时直接返回，模型只能看到 foreground_unavailable 并反复重试。
  // 这里补一次 L3：bring_to_front 精确到 pid+window_id → 前台重试 → 恢复原前台。
  if (force && isForegroundUnavailable(value)
    && payload.pid && payload.window_id !== undefined && payload.window_id !== null) {
    return escalateViaBringToFront(tool, payload, call)
  }
  if (force || deliveryMode !== 'auto') return { value, note: '' }
  if (!isBackgroundUnavailable(value)) {
    if (isForegroundUnavailable(value)) {
      return { value, note: `\n（前台投递被 Windows 前台锁拦截：${firstLine(value)}）` }
    }
    if (isUnverified(value) && payload.pid && UNVERIFIED_ESCALATE_TOOLS.has(tool)) {
      return escalateViaBringToFront(tool, payload, call)
    }
    return { value, note: '' }
  }
  // L2: background 被拒 → foreground 重试（驱动自带激活+恢复）。
  // driver 的拒绝可能以非 JSON 退出（rawCall 抛错）表达——规范化为 {error} 参与升级链判定。
  value = await call(tool, { ...payload, delivery_mode: 'foreground' })
    .catch((e) => ({ error: String((e && e.message) || e) }))
  if (!isForegroundUnavailable(value)) {
    if (isUnverified(value) && payload.pid && UNVERIFIED_ESCALATE_TOOLS.has(tool)) {
      return escalateViaBringToFront(tool, payload, call)
    }
    return { value, note: '\n（后台投递不可用 → 已前台重试一次，驱动已恢复原前台焦点）' }
  }
  // L3: 前台锁拦截 → bring_to_front 绕锁 → 前台重试 → 恢复原前台
  if (tool === 'hotkey' || !payload.pid) {
    // hotkey 的 XAML 先验拒绝重试同样失败；无窗口目标（scope=desktop）无锁可绕
    return { value, note: `\n（前台投递被前台锁拦截：${firstLine(value)}）` }
  }
  return escalateViaBringToFront(tool, payload, call)
}

/**
 * 恢复 previous_fg_hwnd 的原前台窗口。
 * 驱动 bring_to_front 需要 pid + window_id；previous_fg_hwnd 只给了 hwnd，
 * 因此先查 windowMap（观察时已记录），未知时补一次 list_windows。
 * 旧实现只传 {session, window_id}，15/15 次被驱动以 missing pid 拒绝，却仍写“已恢复”。
 */
async function restoreForeground(call, session, hwnd) {
  if (hwnd === undefined || hwnd === null) return { ok: false, reason: 'no previous_fg_hwnd' }
  let pid = pidOfWindow(hwnd)
  if (!pid) {
    // 原前台可能已最小化/离屏；不能只用 on_screen_only，否则永远查不到 pid。
    const list = await call('list_windows', {}).catch(() => null)
    if (list && Array.isArray(list.windows)) {
      rememberWindows(list.windows)
      pid = pidOfWindow(hwnd)
    }
  }
  if (!pid) return { ok: false, reason: `unknown pid for window ${hwnd}` }
  const value = await call('bring_to_front', { session, pid, window_id: hwnd })
    .catch((e) => ({ error: String((e && e.message) || e) }))
  const refusal = engineRefusal(value)
  const failed = Boolean(refusal) || Boolean(value && typeof value === 'object' && value.error)
  return { ok: !failed, reason: refusal || (value && value.error) || '' }
}

/**
 * 强制前台指针动作的专用前置：先 bring_to_front，再只执行一次，最后恢复原前台。
 * 不用“失败后 L3 重试”：重试会把点击/拖拽执行两次（t11 drag 9s 画两遍；
 * t15 16 次 foreground click 全部重试、单次约 9s）。auto 路径保持原 L3。
 */
async function preflightForegroundAction(tool, payload, call) {
  const label = tool === 'drag' ? '拖拽' : tool === 'scroll' ? '滚动' : '点击'
  const target = { session: payload.session, pid: payload.pid }
  if (payload.window_id !== undefined && payload.window_id !== null) target.window_id = payload.window_id
  const prev = await call('bring_to_front', target).catch(() => null)
  const prevRefusal = prev ? engineRefusal(prev) : ''
  const value = await call(tool, { ...payload, delivery_mode: 'foreground' })
    .catch((e) => ({ error: String((e && e.message) || e) }))
  if (isForegroundUnavailable(value)) {
    // 前置后仍被锁：本次未发送输入，交给既有绕锁重试是安全的。
    return escalateViaBringToFront(tool, payload, call)
  }
  const failed = deliveryFailure(value) || Boolean(value && typeof value === 'object' && value.error)
  const unverified = isUnverified(value)
  let restoreNote = '原前台未恢复，请检查'
  if (prev && prev.previous_fg_hwnd !== undefined && prev.previous_fg_hwnd !== null) {
    const restored = await restoreForeground(call, payload.session, prev.previous_fg_hwnd)
    restoreNote = restored.ok
      ? '已恢复原前台窗口'
      : `原前台恢复未确认${restored.reason ? `（${restored.reason}）` : ''}`
  }
  const prefix = prevRefusal ? `bring_to_front 首跳被拒：${prevRefusal}；` : ''
  const why = failed
    ? `前置后${label}仍未送达`
    : unverified
      ? `已前置目标并${label}一次（未验证）`
      : `已前置目标并${label}一次`
  return { value, note: `\n（${prefix}${why}；${restoreNote}）` }
}

async function escalateViaBringToFront(tool, payload, call) {
  const target = { session: payload.session, pid: payload.pid }
  if (payload.window_id !== undefined && payload.window_id !== null) target.window_id = payload.window_id
  const prev = await call('bring_to_front', target).catch(() => null)
  const prevRefusal = prev ? engineRefusal(prev) : ''
  const value = await call(tool, { ...payload, delivery_mode: 'foreground' })
    .catch((e) => ({ error: String((e && e.message) || e) }))
  const failed = deliveryFailure(value) || Boolean(value && typeof value === 'object' && value.error)
  const unverified = isUnverified(value)
  if (prev && prev.previous_fg_hwnd !== undefined && prev.previous_fg_hwnd !== null) {
    const restored = await restoreForeground(call, payload.session, prev.previous_fg_hwnd)
    const restoreNote = restored.ok
      ? '已恢复原前台窗口'
      : `原前台恢复未确认${restored.reason ? `（${restored.reason}）` : ''}`
    const prefix = prevRefusal ? `bring_to_front 首跳被拒：${prevRefusal}；` : ''
    const note = failed
      ? `${prefix}bring_to_front 绕锁后重试仍未送达；${restoreNote}`
      : unverified
        ? `${prefix}bring_to_front 绕锁后重试已发送（未验证）；${restoreNote}`
        : `${prefix}bring_to_front 绕锁后重试完成；${restoreNote}`
    return { value, note: '\n（' + note + '）' }
  }
  const why = prevRefusal ? `：${prevRefusal}` : ''
  return { value, note: `\n（bring_to_front 未确认成功${why}，原前台未恢复，请检查）` }
}

/**
 * 归一化 MCP 形状的返回：若结果带 content 数组（[{type:'text',text}]），
 * 提取文本拼接；否则原样返回。cuaCall 已用 driver/normalize 解包结构化 JSON；
 * 这里保留给 receipt/旧调用方，语义不变。
 */
export function normalizeMcp(value) {
  if (value && Array.isArray(value.content)) {
    const texts = value.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
    if (texts.length > 0) return texts.join('\n')
  }
  return value
}
