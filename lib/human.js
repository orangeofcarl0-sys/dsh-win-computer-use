/**
 * human.js —— 真人操作模块：像素级虚拟光标（看得见过程）。
 *
 * 坐标语义（cua-driver 0.21+）：click / drag / scroll 的 x,y 均为
 * "窗口本地截图像素"（get_window_state 返回的 PNG 同一空间，左上原点）。
 * 因此坐标不再做任何 ×2 / 窗口偏移换算 —— 模型看到的截图坐标即动作坐标。
 *
 * 点击寻址：
 *   - element 编号模式 → 用引擎官方推荐的 element_token（AX 路径，精确定位，
 *     支持后台/隐藏窗口，无需坐标；引擎文档明确 "Prefer element_token"）
 *   - x/y 坐标模式 → 像素路径（CGEvent），坐标 = 窗口本地截图像素
 */
import { cuaCall, cuaDeliver, cuaDriverCapabilities, CUA_SESSION, withSession } from './cua.js'
import { clearSnapshot, getSnapshot, isFresh } from './snapshot.js'

/** 滑行段数（human 模式：越多越平滑，真人手部轨迹感）。 */
const GLIDE_SEGMENTS = 5
/** 每段间隔 ms。 */
const GLIDE_STEP_MS = 70
/** 弧线高度（px，模拟人手弧线轨迹）。 */
const ARC_HEIGHT = 40
/** 小于该距离不画弧，只做一次终点移动。 */
const MIN_GLIDE_DISTANCE = 4
/** 同目标跳过：同一窗口、16px 内、2s 内不再重复移动（连续点击同一按钮）。 */
const SAME_TARGET_PX = 16
const SAME_TARGET_MS = 2000
let lastGlide = null   // { key, x, y, at }

/** 重置滑行状态（插件重新 apply / 测试隔离）。 */
export function resetCursorMotion() { lastGlide = null }

function sameTargetAs(tx, ty, key) {
  return Boolean(lastGlide)
    && lastGlide.key === key
    && Date.now() - lastGlide.at <= SAME_TARGET_MS
    && Math.hypot(tx - lastGlide.x, ty - lastGlide.y) <= SAME_TARGET_PX
}

function rememberGlide(tx, ty, key) {
  lastGlide = { key, x: tx, y: ty, at: Date.now() }
}

/**
 * 光标滑行：从当前位置移动到目标。最佳努力，失败不阻断点击。
 *
 * 2026-11-15 t01 实测：驱动单次 move_cursor 在 Windows 上约 2–3s，旧实现固定 5 段，
 * 一次前台点击光移动就花 12–15s，用户看到一串“多次移动一小段”。因此：
 *   - auto（默认）：只做一次终点移动，不查光标、不画弧；
 *   - human：保留 5 段弧线（演示/需要轨迹感时显式开启）；
 *   - 同窗口同目标 2s 内再次点击：完全跳过移动。
 * @param {number} tx - 目标 x（窗口本地截图像素）
 * @param {number} ty - 目标 y
 * @param {object} opts - { target, origin, motion }
 */
export async function glideCursor(tx, ty, opts = {}) {
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return
  const { motion, origin, ...moveOpts } = opts
  const key = `${moveOpts.target?.pid ?? ''}:${moveOpts.target?.window_id ?? ''}`
  if (sameTargetAs(tx, ty, key)) return
  const caps = await cuaDriverCapabilities().catch(() => null)
  const needsScreen = caps?.moveCursorScreen === true
  if (needsScreen && (!origin || typeof origin.x !== 'number' || typeof origin.y !== 'number')) {
    // 0.52+ window scope 要屏幕坐标；没有窗口原点时不移动覆盖层（点击仍继续）。
    return
  }
  const toMove = (x, y) => (needsScreen ? { x: x + origin.x, y: y + origin.y } : { x, y })
  const tryMove = (payload) => cuaCall('move_cursor', payload).catch(() => undefined)

  // auto：单次终点移动。不再为“平滑”付 5 次驱动往返。
  if (motion !== 'human') {
    await tryMove(withSession({ ...toMove(tx, ty), ...moveOpts }))
    rememberGlide(tx, ty, key)
    return
  }

  // human：保留原弧线；拿不到光标/原点时退化为单次移动。
  let cur = null
  try {
    cur = await cuaCall('get_cursor_position', { session: CUA_SESSION })
  } catch { /* 无光标信息 → 直线 */ }
  // get_cursor_position 返回屏幕坐标；窗口本地 = 屏幕 - origin。
  if (!origin || typeof origin.x !== 'number' || typeof origin.y !== 'number') {
    await tryMove(withSession({ ...toMove(tx, ty), ...moveOpts }))
    rememberGlide(tx, ty, key)
    return
  }
  const sx = cur?.x != null ? cur.x - origin.x : tx
  const sy = cur?.y != null ? cur.y - origin.y : ty
  const dist = Math.hypot(tx - sx, ty - sy)

  // 已在目标附近：只做一次终点移动，不画弧、不产生一串小段移动。
  if (!Number.isFinite(dist) || dist < MIN_GLIDE_DISTANCE) {
    await tryMove(withSession({ ...toMove(tx, ty), ...moveOpts }))
    rememberGlide(tx, ty, key)
    return
  }

  // 短距离按距离缩放弧高，避免“小距离也抬 40px”的怪异轨迹。
  const arc = Math.min(ARC_HEIGHT, dist / 2)
  for (let i = 1; i <= GLIDE_SEGMENTS; i++) {
    const t = i / GLIDE_SEGMENTS
    const x = sx + (tx - sx) * t
    // 弧线：中间点抬高（模拟人手画弧）；t=1 已到终点，不再额外发重复移动
    const y = sy + (ty - sy) * t - Math.sin(t * Math.PI) * arc
    await tryMove(withSession({ ...toMove(x, y), ...moveOpts }))
    if (i < GLIDE_SEGMENTS) await new Promise((r) => setTimeout(r, GLIDE_STEP_MS))
  }
  rememberGlide(tx, ty, key)
}

/**
 * 窗口本地截图像素 ⇄ 屏幕坐标换算不再需要：0.21.0 直接接受截图像素。
 * 保留函数仅为兼容旧调用（坐标原样返回）。
 */
export function windowLocalOf(x, y, _snap) {
  return { x, y }
}

/**
 * 真人点击：滑行到目标 + 点击。
 * element 模式（带 token）走引擎 AX 路径（element_token，精确定位）；
 * 坐标模式走像素路径（x/y = 窗口本地截图像素，模型直接可见的坐标）。
 * 前后台投递：deliveryMode/forceForeground 交由 cuaDeliver 统一处理
 * （background 默认不抢焦点；auto 后台失败自动前台重试一次）。
 * @param {object} opts - { pid, windowId, x, y, sx, sy, token, count, button, modifier, deliveryMode, forceForeground }
 * @returns {Promise<{value:any, escalated:boolean}>}
 */
export async function humanClick(opts) {
  const {
    pid, windowId, x, y, sx, sy, token, origin,
    count = 1, button = 'left', modifier = [],
    deliveryMode = 'background', forceForeground = false, glide = true, motion = 'auto',
    fromZoom = false,
  } = opts

  // 1. 光标滑行到目标（auto 单次 / human 弧线；后台投递由 cursorMotion 关闭）。
  //    from_zoom 的 x/y 是 zoom 图像坐标，不是窗口坐标：不做可视滑行，避免指针跑偏。
  if (!fromZoom && glide && sx != null && sy != null) {
    await glideCursor(sx, sy, { target: { kind: 'window', pid, window_id: windowId }, origin, motion })
  }

  // 2. 点击：token 优先（AX 路径），否则像素路径（窗口本地截图像素）
  const payload = { session: CUA_SESSION, pid }
  if (fromZoom) {
    if (x == null || y == null) throw new Error('humanClick: from_zoom 缺少图像坐标（x/y）。')
    payload.window_id = windowId
    payload.x = x
    payload.y = y
    payload.from_zoom = true
    payload.count = count
    payload.button = button
  } else if (token) {
    payload.element_token = token
    // 精确窗口定位：Win11 记事本单进程多窗口（主窗/另存为/覆盖确认同 pid），
    // 只带 pid 时 bring_to_front/升级链可能选错窗口。token 路径也带 window_id。
    if (windowId !== undefined && windowId !== null) payload.window_id = windowId
    // token 路径同样透传计数/按钮，否则双击/右键会静默退化成单次左键
    payload.count = count
    payload.button = button
  } else {
    if (x == null || y == null) throw new Error('humanClick: 缺少点击坐标（x/y）。')
    payload.window_id = windowId
    payload.x = x
    payload.y = y
    payload.count = count
    payload.button = button
  }
  if (Array.isArray(modifier) && modifier.length) payload.modifier = modifier
  return cuaDeliver('click', payload, deliveryMode, { forceForeground })
}

/**
 * 快照辅助：解析编号 → token + 坐标（窗口截图空间）。
 * 元素点击同样受 TTL 约束：过期快照不允许继续点，避免用陈旧编号反复命中旧界面。
 */
export function resolveClickTarget(index, ttlMs) {
  const snap = getSnapshot()
  if (!snap) throw new Error('没有可用的观察快照：请先调用 screen_observe。')
  if (!isFresh(ttlMs)) {
    const expired = snap
    clearSnapshot()
    throw new Error(`[snapshot_expired] 观察快照已过期（超过 ${Math.round(ttlMs / 1000)} 秒，快照 ${expired.snapshotId ?? '未知'}）：界面可能已变化，请重新调用 screen_observe。`)
  }
  const entry = snap.entries?.get(index)
  if (!entry) throw new Error(`编号 [${index}] 不在当前快照中。`)
  const pt = screenPointOf(entry, snap)
  if (!entry.token && !pt) {
    throw new Error(`[index_no_coordinate] 编号 [${index}] 既没有 element_token 也没有坐标，无法可靠点击；请重新 screen_observe。`)
  }
  const local = windowLocalOf(entry.x, entry.y, snap)
  return {
    pid: snap.pid,
    windowId: snap.windowId,
    token: entry.token || null,
    index: Number(index),
    role: entry.role || '',
    label: entry.label || '',
    value: entry.value || '',
    x: local.x,
    y: local.y,
    sx: pt?.sx,
    sy: pt?.sy,
    origin: snap.screenOrigin || null,
  }
}

/** 快照辅助：元素坐标（窗口截图空间；快照写入时已减窗口原点）。 */
export function screenPointOf(entry, _snap) {
  if (!entry || entry.x == null || entry.y == null) return null
  return { sx: entry.x, sy: entry.y }
}

/** 角色中文名（回执回显用；快照存的是驱动原生命名）。 */
const ROLE_CN = {
  Button: '按钮', Edit: '输入框', ComboBox: '下拉框', MenuItem: '菜单项',
  TabItem: '标签页', ListItem: '列表项', CheckBox: '复选框', RadioButton: '单选',
  Hyperlink: '链接', Slider: '滑块', Spinner: '微调框', SplitButton: '拆分按钮',
  TreeItem: '树项', Document: '文档', Text: '文本', AXButton: '按钮',
  AXTextField: '输入框', AXTextArea: '文本框', AXMenuItem: '菜单项', AXComboBox: '下拉框',
}
const roleCn = (r) => ROLE_CN[r] || r || '元素'
const VALUE_ECHO_ROLES = new Set(['Edit', 'ComboBox', 'Spinner', 'Slider', 'AXTextField', 'AXComboBox', 'AXSlider'])

/** 坐标点击时找最近的可交互元素（快照条目中心；用于回执“你实际点到了什么”）。 */
export function nearestEntry(snap, x, y, maxDist = 24) {
  let best = null
  let bestD = Infinity
  for (const [index, e] of snap?.entries || []) {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue
    const d = Math.hypot(Number(x) - e.x, Number(y) - e.y)
    if (d <= maxDist && d < bestD) {
      bestD = d
      best = { index, ...e, distance: Math.round(d) }
    }
  }
  return best
}

/**
 * 动作目标回显：`[3] 按钮 "否(N)" @(465,171)`。
 * 2026-11-15 t01 实证：模型点 (465,171) 本意是“是”，实际是“否(N)”；回执不回显目标时
 * 模型/用户都无法发现点错，只能继续循环。
 */
export function describeClickTarget(snap, args = {}) {
  if (!snap) return ''
  let entry = null
  let prefix = ''
  if (args.element !== undefined && args.element !== null) {
    const i = Number(args.element)
    entry = snap.entries?.get(i) || null
    prefix = `[${i}]`
    if (!entry) return `${prefix}（不在当前快照）`
  } else if (args.x !== undefined && args.y !== undefined) {
    entry = nearestEntry(snap, args.x, args.y)
    prefix = entry ? `≈ [${entry.index}]` : `坐标 (${args.x},${args.y})`
    if (!entry) return `${prefix}（附近无可交互元素）`
  } else {
    return ''
  }
  const bits = [prefix, roleCn(entry.role)]
  if (entry.label) bits.push(`"${String(entry.label).slice(0, 32)}"`)
  if (VALUE_ECHO_ROLES.has(String(entry.role || '')) && entry.value && entry.value !== entry.label) {
    bits.push(entry.is_password ? '值（已隐藏）' : `值="${String(entry.value).slice(0, 32)}"`)
  }
  if (Number.isFinite(entry.x) && Number.isFinite(entry.y)) bits.push(`@(${entry.x},${entry.y})`)
  return bits.join(' ')
}