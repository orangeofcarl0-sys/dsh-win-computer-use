/**
 * actions.js —— 动作工具实现：点击 / 双击 / 右键 / 输入 / 按键 / 滚动 / 拖拽。
 *
 * 每个动作都基于 screen_observe 的快照：
 *  - element 编号模式 → 透传 element_token（引擎校验快照是否过期）
 *  - x/y 坐标模式 → 使用快照窗口的 window-local 像素坐标
 */
import { cuaCall, cuaDeliver, isBackgroundUnavailable, isForegroundUnavailable, isUnverified, normalizeMcp, withSession, deliveryFailure } from './cua.js'
import { engineRefusal, isSuspectedNoop, uiaAcceleratorTimeout, uiaAcceleratorUnavailable } from './engine.js'
import { refreshSnapshotState, getLastZoom, isDocumentRole } from './observe.js'
import {
  freshnessGate, getSnapshot, resolveToken, resolveWindow, validateSnapshotId,
  getInputUnconfirmed, markInputUnconfirmed, clearInputUnconfirmed,
} from './snapshot.js'
import { settleAction, MENU_CLICK_NOTE, DOCUMENT_INPUT_NOTE } from './receipt.js'
import { tryXamlKeyFallback, xamlKeyGuidance, snapshotHasMenuBar } from './keyFallback.js'
import { isMenuRole, isTopMenuBarLabel, menuStateOf } from './menu.js'
import { describeClickTarget, humanClick, resolveClickTarget, screenPointOf, windowLocalOf, nearestEntry } from './human.js'
import { pidOfWindow, rememberWindows } from './windowMap.js'

/**
 * verifyAfterAction（默认 off）：对 unverifiable/suspected_noop 的点击/按键动作
 * （含坐标点击），抓一次无截图窗口状态，把差分写进动作回执；结构性变化直接清快照。
 * 不改变默认路径；只有显式 verifyAfterAction=auto 才会多付 ~2s/动作。
 */
async function postActionVerify(cfg, value, snap, { menuClick = false } = {}) {
  if (cfg.verifyAfterAction !== 'auto' || !snap) return ''
  if (!isUnverified(value) && !isSuspectedNoop(value)) return ''
  const r = await refreshSnapshotState(cfg, snap.pid, snap.windowId)
  if (!r.ok) return `（动作后复核：${r.reason}；旧快照已清空，请 screen_observe。）`
  // 菜单栏点击的复核优先给菜单态：菜单可能在同窗口、也可能在独立 popup 窗口。
  // 只用本次已抓取的 rawElements（同窗口），不额外付出跨窗口 get_window_state。
  if (menuClick) {
    const menu = menuStateOf(r.rawElements)
    if (menu.open === true) {
      return `（动作后复核：检测到弹出菜单项${r.structural ? '，旧快照已清空，请重新观察取编号' : ''}；不要重复点菜单栏。）`
    }
    return '（动作后复核：本窗口未检测到弹出菜单项；菜单可能已关闭或在独立弹出窗口。不要重复点同一菜单栏项；先 screen_observe 或改用 computer_menu。）'
  }
  if (r.structural) return '（动作后复核：界面结构已变化，旧快照已清空；请 screen_observe 获取新编号。）'
  if (r.changes?.changed) return `（动作后复核：${r.changes.summary}）`
  return '（动作后复核：窗口内未观察到变化；不要重复，先 screen_observe 确认。）'
}

/** 本次点击是否落在顶层菜单栏项上；坐标模式用最近元素（24px）判定，from_zoom 不猜。 */
function isMenuBarClick(snap, target, args) {
  if (args?.from_zoom === true) return false
  if (args?.element !== undefined && args?.element !== null) {
    return isMenuRole(target?.role) && isTopMenuBarLabel(target?.label)
  }
  if (args?.x !== undefined && args?.y !== undefined) {
    const near = nearestEntry(snap, Number(args.x), Number(args.y))
    return Boolean(near) && isMenuRole(near.role) && isTopMenuBarLabel(near.label)
  }
  return false
}

/**
 * 输入回读：type_text/set_value 的结果不可信时，抓一次无截图窗口状态，
 * 用控件 value 逐字比较请求文本。只在失败/未验证路径执行（约 1-2s），
 * 不回显正文，只报长度/状态；不一致时设置 inputUnconfirmed，保存意图会被 guard 拦截。
 *
 * 为什么不能复用 diffObserve：normalizeForHash 会折叠空白/换行，
 * 恰好掩盖 t01 r2 的 `S4-T01  oneline.` 这类污染。这里用 CRLF→LF 后逐字比较。
 */
function normInputText(s) {
  return String(s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function pickInputElement(raw, { elementIndex, elementRole, elementLabel, expected }) {
  const rawList = Array.isArray(raw) ? raw : []
  if (elementIndex !== undefined && elementIndex !== null) {
    const byIndex = rawList.find((e) => Number(e.element_index) === Number(elementIndex))
    if (byIndex) return byIndex
    const byMeta = rawList.find((e) => String(e.role || '') === String(elementRole || '')
      && String(e.label || '') === String(elementLabel || ''))
    if (byMeta) return byMeta
  }
  const docs = rawList.filter((e) => /^(Document|AXTextArea|TextArea)$/i.test(String(e.role || '')))
  if (docs.length === 1) return docs[0]
  if (docs.length > 1) {
    const want = normInputText(expected)
    return docs.find((e) => normInputText(e.value).includes(want)) || null
  }
  return null
}

/** 快照里是否存在 Document/TextArea（无 element 的焦点输入可能落在这里）。 */
function snapshotHasDocument(snap) {
  for (const e of snap?.entries?.values?.() || []) {
    if (isDocumentRole(e.role)) return true
  }
  return false
}

async function postInputVerify(cfg, tool, value, snap, {
  expected, elementIndex = null, elementRole = '', elementLabel = '', exact = false,
} = {}) {
  const failure = deliveryFailure(value)
  const hard = Boolean(failure)
  const guard = snap ? getInputUnconfirmed(snap.pid, snap.windowId) : null
  const uncertain = Boolean(failure) || isSuspectedNoop(value) || isUnverified(value) || Boolean(guard)
  if (!snap || !uncertain) return ''
  const requestedLen = normInputText(expected).length

  const r = await refreshSnapshotState(cfg, snap.pid, snap.windowId)
  if (!r.ok) {
    if (hard) {
      markInputUnconfirmed({
        pid: snap.pid, windowId: snap.windowId, tool,
        reason: r.reason || '无法回读', requestedLen,
      })
      return `（输入回读：无法读取正文（${r.reason || '窗口不可用'}）；保存已阻止，请用 native/zoom 核对。驱动报告投递失败，可能只写入了部分文本。）`
    }
    return `（输入回读：无法读取正文（${r.reason || '窗口不可用'}）；请用 native/zoom 核对后再保存。）`
  }
  if (r.structural) {
    if (hard) {
      markInputUnconfirmed({
        pid: snap.pid, windowId: snap.windowId, tool,
        reason: '界面结构变化，无法定位输入控件', requestedLen,
      })
      return '（输入回读：界面结构已变化，无法确认输入；保存已阻止，请重新观察并核对正文。）'
    }
    return '（输入回读：界面结构已变化，无法确认输入；请先 native/zoom 核对正文。）'
  }

  const target = pickInputElement(r.rawElements, { elementIndex, elementRole, elementLabel, expected })
  if (!target) {
    if (hard) {
      markInputUnconfirmed({
        pid: snap.pid, windowId: snap.windowId, tool,
        reason: '窗口没有可回读的文本控件', requestedLen,
      })
      return '（输入回读：无法读取正文；保存已阻止，请用 native/zoom 核对。不要仅凭字符数保存。）'
    }
    return '（输入回读：窗口没有可回读的文本控件；请用 native/zoom 核对正文后再保存。）'
  }

  const actual = normInputText(target.value)
  const actualLen = actual.length
  const want = normInputText(expected)
  const matches = exact ? actual === want : actual.includes(want)
  if (matches) {
    clearInputUnconfirmed(snap.pid, snap.windowId)
    return `（输入回读：一致，${actualLen} 字符；可继续保存。）`
  }

  markInputUnconfirmed({
    pid: snap.pid, windowId: snap.windowId, tool,
    reason: '输入回读不一致', requestedLen, actualLen,
  })
  const dirtyNote = tool === 'set_value' && r.dirty === false
    ? ' 应用未显示未保存标记；ValuePattern 可能不置脏，保存前请用 type 触发一次真实编辑。'
    : ''
  return `（输入回读：不一致（请求 ${requestedLen} 字符，实际 ${actualLen} 字符）；保存已阻止，先修正/重输并观察。${dirtyNote}）`
}

/**
 * 构造一次"基于编号或坐标"的引擎调用参数。
 * 坐标语义：screen_observe 输出的元素坐标是屏幕 pt（cua-driver 0.19.3 的
 * frame 即屏幕坐标），引擎 click/scroll/drag 需要 window-local，故换算。
 * @returns {object} 传给 cua-driver 的参数字段
 */
function targetArgs(args, cfg, extra = {}) {
  const out = {}
  const snap = getSnapshot()
  if (args.element !== undefined && args.element !== null) {
    const { pid, token } = resolveToken(Number(args.element), cfg.ttlMs)
    out.pid = pid
    out.element_token = token
  } else if (args.x !== undefined || args.y !== undefined) {
    if (args.x === undefined || args.y === undefined) {
      throw new Error('坐标模式必须同时提供 x 和 y。')
    }
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    const local = windowLocalOf(Number(args.x), Number(args.y), snap)
    out.pid = pid
    out.window_id = windowId // 坐标点击需 window_id 定位目标窗口（避免多窗口歧义）
    out.x = local.x
    out.y = local.y
  } else {
    throw new Error('必须提供 element（观察编号）或 x/y 坐标。')
  }
  return withSession({ ...out, ...extra })
}

/** Windows 手势修饰键：click 家族已真机验证；drag 的 driver 0.23.2 不投递，故不开放。 */
const GESTURE_MODIFIERS = new Set(['ctrl', 'shift', 'alt', 'win'])

function gestureModifiers(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new Error('modifier 必须是字符串数组（如 ["ctrl"]）。')
  }
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new Error('modifier 只接受字符串数组（ctrl/shift/alt/win）。')
    }
    const key = raw.trim().toLowerCase()
    const canon = key === 'control' ? 'ctrl' : key === 'option' ? 'alt' : key
    if (!GESTURE_MODIFIERS.has(canon)) {
      throw new Error(`modifier 不支持 "${raw}"；只接受 ctrl/shift/alt/win。`)
    }
    if (!out.includes(canon)) out.push(canon)
  }
  return out
}

/**
 * 真人点击：解析目标（编号或坐标）→ 光标滑行 → 像素点击。
 * modifier 非空时强制前台：Windows 的修饰键状态只能通过 SendInput 进入目标，
 * driver 会拒绝后台投递；这里显式升级并在回执说明。
 * @returns {Promise<{ok:boolean, result:string}>}
 */
async function humanAction(label, tool, args, cfg, extra = {}) {
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  const snap = getSnapshot()
  const fromZoom = args.from_zoom === true
  const hasModifier = Array.isArray(extra.modifier) && extra.modifier.length > 0
  let target
  if (fromZoom) {
    if (args.element !== undefined && args.element !== null) {
      throw new Error('from_zoom 与 element 二选一：图内坐标请传 x/y + from_zoom=true；元素点击请只传 element。')
    }
    if (args.x === undefined || args.y === undefined) {
      throw new Error('from_zoom=true 需要同时提供 x 和 y（最近一次 screen_zoom 图的像素坐标）。')
    }
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    const z = getLastZoom(pid, windowId)
    if (!z) {
      throw new Error('[zoom_missing] 没有可用于当前窗口的 zoom 图：请先 screen_zoom(pid/window_id) 再点击；不要猜坐标。')
    }
    if (snap && z.at < snap.at) {
      throw new Error('[zoom_stale] 最近一次 zoom 早于当前观察：图可能已过期，请重新 screen_zoom 后再点击。')
    }
    target = {
      pid,
      windowId,
      x: Number(args.x),
      y: Number(args.y),
      sx: null,
      sy: null,
      origin: null,
      fromZoom: true,
    }
  } else if (args.element !== undefined && args.element !== null) {
    target = resolveClickTarget(Number(args.element), cfg.ttlMs)
  } else if (args.x !== undefined && args.y !== undefined) {
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    const sx = Number(args.x)
    const sy = Number(args.y)
    const local = windowLocalOf(sx, sy, snap)
    target = {
      pid,
      windowId,
      x: local.x,
      y: local.y,
      sx,
      sy,
      origin: snap?.screenOrigin || null,
    }
  } else {
    throw new Error('必须提供 element（观察编号）或 x/y 坐标。')
  }
  const motion = cfg.cursorMotion || 'auto'
  const glide = !fromZoom
    && motion !== 'off'
    && (args.foreground === true || cfg.deliveryMode !== 'background')
  const echo = fromZoom
    ? `from_zoom 图内 (${args.x},${args.y})（驱动映射）`
    : describeClickTarget(snap, args)
  const { value, note } = await humanClick({
    ...target, ...extra,
    deliveryMode: cfg.deliveryMode,
    forceForeground: args.foreground === true || hasModifier,
    glide,
    motion,
  })
  const menuBarClick = isMenuBarClick(snap, target, args)
  const postNote = await postActionVerify(cfg, value, snap, { menuClick: menuBarClick })
  // element_not_visible 实测有两种情形（2026-09-16 Win11 记事本菜单路径）：确实未生效；或
  // 驱动误报而动作已落地（随后对话框弹出）。两者都无法从回执区分，故只给可执行指引、不做自动重试
  // （曾试过"bring_to_front 后自动重试"，实测无增益且增加复杂度，已按测量驱动原则撤除）。
  const refusalNote = (/element_not_visible/i.test(engineRefusal(value) || '')
    ? '。该拒绝可能是误报（动作也许已生效）：请先用 screen_observe 或 computer_verify 确认状态再决定是否重试；'
      + '若确需重试，先让目标窗口获得前台（app_launch 带 bring_to_front，或对其点一次）；'
      + '目标是 XAML/WinUI 应用（记事本等）时快捷键不可用，请一律走"点击控件（菜单项/按钮）"路径。'
    : '') + (menuBarClick ? MENU_CLICK_NOTE : '')
  const modifierNote = hasModifier
    ? '（modifier 需前台注入：已自动前台投递并恢复原前台）'
    : ''
  return settleAction(tool, value, {
    label,
    note,
    preNote: (echo ? `（目标 ${echo}）` : '') + modifierNote + postNote,
    gateNote: gate.note,
    refusalNote,
    unverifiedNote: menuBarClick ? MENU_CLICK_NOTE : '',
    verbose: cfg.verboseReceipts === true,
  })
}

/** computer_click —— 真人操作：光标滑行 + 像素点击 */
export async function click(args, cfg) {
  const extra = {}
  if (args.count) extra.count = Number(args.count)
  const modifier = gestureModifiers(args.modifier)
  if (modifier.length) extra.modifier = modifier
  return humanAction('点击', 'click', args, cfg, extra)
}

/** computer_double_click */
export async function doubleClick(args, cfg) {
  const extra = { count: 2 }
  const modifier = gestureModifiers(args.modifier)
  if (modifier.length) extra.modifier = modifier
  return humanAction('双击', 'double_click', args, cfg, extra)
}

/** computer_right_click */
export async function rightClick(args, cfg) {
  const extra = { button: 'right' }
  const modifier = gestureModifiers(args.modifier)
  if (modifier.length) extra.modifier = modifier
  return humanAction('右键点击', 'right_click', args, cfg, extra)
}

/** computer_type —— 文本输入（可指定元素；未指定时输入到快照窗口当前焦点） */
export async function typeText(args, cfg) {
  if (!args.text) throw new Error('computer_type: 缺少 text 参数。')
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  const snap = getSnapshot()
  const payload = withSession({ text: String(args.text) })
  let targetNote = ''
  let elementMeta = null
  if (args.element !== undefined && args.element !== null) {
    const { pid, token, windowId, role, label } = resolveToken(Number(args.element), cfg.ttlMs)
    payload.pid = pid
    payload.window_id = windowId
    payload.element_token = token
    elementMeta = { index: Number(args.element), role, label }
    targetNote = `（目标 [${Number(args.element)}] ${role || '元素'}${label ? ` "${String(label).slice(0, 32)}"` : ''}）`
  } else {
    // 无指定元素：仍绑定到新鲜快照的窗口，禁止盲发 desktop scope（P0，2026-11-09）。
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    payload.pid = pid
    payload.window_id = windowId
    targetNote = `（未指定 element：输入到快照窗口 pid=${pid} window_id=${windowId} 当前焦点；密码保护无法预判焦点控件。）`
  }
  // 文档类输入：UIA 注入可能不置“未保存”标记；不加驱动调用，只用静态注记阻止模型误判。
  const documentNote = elementMeta
    ? (isDocumentRole(elementMeta.role) ? DOCUMENT_INPUT_NOTE : '')
    : (snapshotHasDocument(snap) ? DOCUMENT_INPUT_NOTE : '')
  const { value: vRaw, note } = await cuaDeliver('type_text', payload, cfg.deliveryMode, {
    forceForeground: args.foreground === true,
  })
  const postNote = await postInputVerify(cfg, 'type_text', vRaw, snap, {
    expected: String(args.text),
    elementIndex: elementMeta?.index,
    elementRole: elementMeta?.role,
    elementLabel: elementMeta?.label,
    exact: false,
  })
  return settleAction('type_text', vRaw, {
    label: '输入',
    note,
    preNote: targetNote + documentNote + postNote,
    gateNote: gate.note,
    inputKind: 'type',
    verbose: cfg.verboseReceipts === true,
  })
}

/**
 * computer_key —— 按键 / 快捷键（如 return、cmd+c）。
 *
 * 投递通道按目标自动选择：
 *  - 组合键（带修饰键）：走 driver 的 hotkey（目标感知派发）——现代 XAML/WinUI/UWP
 *    目标自动使用 UIA AcceleratorKey 匹配并 Invoke（无焦点窃取、无需系统输入队列，
 *    解决 PostMessage 键进不了 XAML 树的问题）；传统 Win32 带修饰键走
 *    SendInput + 短暂 SetForegroundWindow（驱动自带激活+恢复）。
 *  - 无修饰键：维持 press_key（PostMessage 后台投递，传统 Win32 窗口即可用；
 *    XAML 目标上该通道不会到达，靠 unverifiable 注记提示换 uia/click）。
 */
export async function key(args, cfg) {
  if (!args.key) throw new Error('computer_key: 缺少 key 参数。')
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  const parts = String(args.key).toLowerCase().split('+').map((s) => s.trim())
  const MODS = new Set(['cmd', 'command', 'ctrl', 'control', 'option', 'alt', 'shift', 'fn'])
  const modifiers = parts.filter((p) => MODS.has(p)).map((p) => {
    if (p === 'command') return 'cmd'
    if (p === 'control') return 'ctrl'
    if (p === 'option') return 'alt'
    return p
  })
  const keyName = parts.filter((p) => !MODS.has(p))[0]
  if (!keyName) throw new Error('computer_key: 无法解析按键（示例: return / cmd+c / shift+tab）。')

  // 窗口寻址：必须绑定快照窗口（pid+window_id 精准）；无快照直接拒绝，不再退回桌面作用域。
  const { pid, windowId } = resolveWindow(cfg.ttlMs)
  const windowTarget = { pid, window_id: windowId }
  const snap = getSnapshot()
  const hasMenuBar = snapshotHasMenuBar(snap)
  const fgRequested = args.foreground === true

  const isCombo = modifiers.length > 0
  const tool = isCombo ? 'hotkey' : 'press_key'
  const payload = withSession(isCombo
    ? { keys: [...modifiers, keyName], ...windowTarget }
    : { key: keyName, ...(modifiers.length > 0 ? { modifiers } : {}), ...windowTarget })
  let vRaw
  let deliveryNote = ''
  try {
    ({ value: vRaw, note: deliveryNote } = await cuaDeliver(tool, payload, cfg.deliveryMode, {
      forceForeground: args.foreground === true,
    }))
  } catch (err) {
    const msg = String(err?.message || err)
    if (tool === 'hotkey' && (uiaAcceleratorTimeout(msg) || uiaAcceleratorUnavailable(msg))) {
      const fallback = await tryXamlKeyFallback({ key: args.key, cfg, foreground: fgRequested })
      if (fallback) return fallback
      return {
        ok: false,
        result: xamlKeyGuidance(
          args.key,
          uiaAcceleratorTimeout(msg) ? 'timeout' : 'no-accelerator',
          { hasMenuBar },
        ),
      }
    }
    throw err
  }
  const value = normalizeMcp(vRaw)
  const channelNote = isCombo
    ? '（组合键经 driver hotkey 派发：XAML/WinUI 目标走 UIA 加速器，传统 Win32 走 SendInput 前台交换）'
    : ''
  const refusal = engineRefusal(value)

  // XAML/WinUI 组合键的两种失败形态：4s UIA 超时 + 无 AcceleratorKey。
  // 都不可当作普通拒绝；先尝试实验性控件回退（默认 off），否则给可执行指引。
  if (refusal && (uiaAcceleratorTimeout(refusal) || uiaAcceleratorUnavailable(refusal))) {
    const kind = uiaAcceleratorTimeout(refusal) ? 'timeout' : 'no-accelerator'
    const fallback = await tryXamlKeyFallback({ key: args.key, cfg, foreground: fgRequested })
    if (fallback) return fallback
    return { ok: false, result: xamlKeyGuidance(args.key, kind, { hasMenuBar }) }
  }

  // 投递层失败不是成功：foreground/background 不可用时，目标根本没有收到按键。
  if (!refusal && (isForegroundUnavailable(value) || isBackgroundUnavailable(value))) {
    const why = isForegroundUnavailable(value)
      ? '前台投递被 Windows 前台锁拦截（foreground_unavailable）'
      : '目标拒绝后台投递（background_unavailable）'
    const advice = cfg.deliveryMode === 'background'
      ? '请改用 deliveryMode=auto/foreground'
      : '当前已是 auto/foreground：先让目标窗口获得前台，或改用菜单/控件路径'
    return {
      ok: false,
      result: `按键未送达：${why}。${advice}；不要假设按键已生效。`,
    }
  }

  const postNote = await postActionVerify(cfg, value, snap)
  return settleAction(tool, value, {
    label: '按键',
    key: String(args.key),
    note: deliveryNote,
    preNote: channelNote + postNote,
    gateNote: gate.note,
    verbose: cfg.verboseReceipts === true,
  })
}

/** computer_scroll */
export async function scroll(args, cfg) {
  const dir = args.direction || 'down'
  if (!['up', 'down', 'left', 'right'].includes(dir)) {
    throw new Error('computer_scroll: direction 必须是 up/down/left/right。')
  }
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  const payload = withSession({ direction: dir })
  if (args.amount) payload.amount = Number(args.amount)
  if (args.element !== undefined && args.element !== null) {
    const { pid, token, windowId } = resolveToken(Number(args.element), cfg.ttlMs)
    payload.pid = pid
    payload.window_id = windowId
    payload.element_token = token
  } else {
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    payload.pid = pid
    payload.window_id = windowId
  }
  const { value: vRaw, note } = await cuaDeliver('scroll', payload, cfg.deliveryMode, {
    forceForeground: args.foreground === true,
  })
  return settleAction('scroll', vRaw, {
    label: '滚动',
    key: dir,
    note,
    gateNote: gate.note,
    verbose: cfg.verboseReceipts === true,
  })
}

/** computer_drag —— 拖拽（坐标 = 窗口本地截图像素，与观察输出同空间） */
export async function drag(args, cfg) {
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  const { pid, windowId } = resolveWindow(cfg.ttlMs)
  const snap = getSnapshot()
  const fromZoom = args.from_zoom === true
  const rawCoords = [args.from_x, args.from_y, args.to_x, args.to_y]
  const coords = rawCoords.map(Number)
  if (rawCoords.some((v) => v === null || v === undefined) || !coords.every((v) => Number.isFinite(v))) {
    throw new Error('computer_drag: 需要有效的 from_x/from_y/to_x/to_y（有限数字）。')
  }
  if (fromZoom) {
    const z = getLastZoom(pid, windowId)
    if (!z) {
      throw new Error('[zoom_missing] 没有可用于当前窗口的 zoom 图：请先 screen_zoom(pid/window_id) 再拖拽；不要猜坐标。')
    }
    if (snap && z.at < snap.at) {
      throw new Error('[zoom_stale] 最近一次 zoom 早于当前观察：图可能已过期，请重新 screen_zoom 后再拖拽。')
    }
  }
  let steps
  if (args.steps !== undefined) {
    const n = Number(args.steps)
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      throw new Error('computer_drag: steps 必须是 1-200 的整数。')
    }
    steps = n
  }
  let durationMs
  if (args.duration_ms !== undefined) {
    const n = Number(args.duration_ms)
    if (!Number.isInteger(n) || n < 0 || n > 10000) {
      throw new Error('computer_drag: duration_ms 必须是 0-10000 的整数。')
    }
    durationMs = n
  }
  const payload = withSession({
    pid,
    window_id: windowId,
    from_x: coords[0],
    from_y: coords[1],
    to_x: coords[2],
    to_y: coords[3],
  })
  if (fromZoom) payload.from_zoom = true
  if (steps !== undefined) payload.steps = steps
  if (durationMs !== undefined) payload.duration_ms = durationMs
  const { value: vRaw, note } = await cuaDeliver('drag', payload, cfg.deliveryMode, {
    forceForeground: args.foreground === true,
  })
  return settleAction('drag', vRaw, {
    label: '拖拽',
    note,
    preNote: fromZoom ? '（from_zoom 图内坐标：起终点由驱动映射）' : '',
    gateNote: gate.note,
    verbose: cfg.verboseReceipts === true,
  })
}

/** computer_set_value —— 直接设值（UIA ValuePattern；展开态工具） */
export async function setValue(args, cfg) {
  if (args.value === undefined || args.value === null) throw new Error('computer_set_value: 缺少 value 参数。')
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  const { pid, token, windowId, role, label } = resolveToken(Number(args.element), cfg.ttlMs)
  const snap = getSnapshot()
  const echo = describeClickTarget(snap, { element: Number(args.element) })
  const payload = withSession({ pid, window_id: windowId, element_token: token, value: String(args.value) })
  const vRaw = await cuaCall('set_value', payload)
  const postNote = await postInputVerify(cfg, 'set_value', vRaw, snap, {
    expected: String(args.value),
    elementIndex: Number(args.element),
    elementRole: role,
    elementLabel: label,
    exact: true,
  })
  return settleAction('set_value', vRaw, {
    label: '设值',
    note: '',
    preNote: (echo ? `（目标 ${echo}）` : '') + postNote,
    gateNote: gate.note,
    inputKind: 'set_value',
    refusalNote: '。SetValue 不被 Web/自绘控件采纳时，改用 computer_type(element=编号) 或点击后输入。',
    verbose: cfg.verboseReceipts === true,
  })
}

/** computer_wait —— 本地等待（不调引擎） */
export async function wait(args) {
  const ms = Math.max(0, Math.min(Number(args.ms) || 1000, 60000))
  await new Promise((r) => setTimeout(r, ms))
  return { ok: true, result: `已等待 ${ms}ms。` }
}

/** app_list —— 列出应用（紧凑格式：一行一应用，超限截断） */
export async function listApps() {
  const value = await cuaCall('list_apps')
  const apps = (value.apps || []).filter((a) => a.running)
  const CAP = 20
  const shown = apps.slice(0, CAP)
  const lines = shown.map((a) => {
    const win = a.windows && a.windows.length > 0 ? ` ×${a.windows.length}` : ''
    return `${a.name}${win} pid=${a.pid}${a.active ? ' ★' : ''}`
  })
  const more = apps.length > CAP ? `\n（其余 ${apps.length - CAP} 个未列出；可直接用 window=<pid|标题子串> 指定目标）` : ''
  const result = `运行中应用 ${apps.length} 个：\n${lines.join('\n')}${more}`
  return { ok: true, result, apps: apps.map((a) => ({ name: a.name, pid: a.pid, active: a.active })) }
}

/** computer_activate —— 显式激活已存在窗口（driver bring_to_front；不恢复原前台）。 */
export async function activate(args) {
  const windowId = Number(args.window_id)
  if (!Number.isFinite(windowId) || windowId <= 0) {
    throw new Error('computer_activate: 需要有效的 window_id（screen_observe 或 app_list 输出）。')
  }
  let pid = Number(args.pid)
  if (!Number.isFinite(pid) || pid <= 0) pid = pidOfWindow(windowId)
  if (!pid) {
    // windowMap 只缓存最近一次 list_windows；新窗口/清理后可能未知，补一次再查。
    const list = await cuaCall('list_windows', {}).catch(() => null)
    if (list && Array.isArray(list.windows)) rememberWindows(list.windows)
    pid = pidOfWindow(windowId)
  }
  if (!pid) {
    return {
      ok: false,
      result: `未找到 window_id=${windowId} 的 pid：请先 screen_observe 或 app_list 重新获取窗口 id。`,
      window_id: windowId,
      pid: null,
    }
  }
  const value = await cuaCall('bring_to_front', withSession({ pid, window_id: windowId }))
    .catch((e) => ({ error: String(e?.message || e) }))
  const refusal = engineRefusal(value)
  if (refusal) {
    return { ok: false, result: `激活窗口被引擎拒绝：${refusal}`, window_id: windowId, pid }
  }
  const unverified = isUnverified(value)
  const prev = value && typeof value === 'object' && value.previous_fg_hwnd !== undefined
    ? `；原前台 hwnd=${value.previous_fg_hwnd}`
    : ''
  return {
    ok: true,
    result: `已激活窗口 window_id=${windowId} pid=${pid}${unverified ? '（驱动未验证）' : ''}${prev}`,
    window_id: windowId,
    pid,
  }
}

/** app_launch —— 启动应用（后台），可选前置 */
export async function launchApp(args) {
  if (!args.name && !args.bundle_id) {
    throw new Error('app_launch: 需要 name（应用名）或 bundle_id。')
  }
  const payload = {}
  if (args.bundle_id) payload.bundle_id = String(args.bundle_id)
  else payload.name = String(args.name)
  if (args.creates_new_instance) payload.creates_new_instance = true
  const launched = await cuaCall('launch_app', payload)
  const launchRefusal = engineRefusal(launched)
  if (launchRefusal) {
    return { ok: false, result: `应用启动失败：${launchRefusal}`, pid: null, window_id: null }
  }
  if (launched && typeof launched === 'object' && launched.running === false) {
    return {
      ok: false,
      result: `应用启动未确认：驱动返回 running=false（${JSON.stringify(launched).slice(0, 240)}）`,
      pid: launched.pid ?? null,
      window_id: null,
    }
  }

  const pid = launched?.pid ?? null
  const wins = Array.isArray(launched?.windows) ? launched.windows : []
  const mainWin = wins.find((w) => w && w.window_id
    && w.is_on_screen !== false && w.minimized !== true)
    || wins.find((w) => w && w.window_id)
    || null
  const windowId = mainWin ? Number(mainWin.window_id) : null
  let frontNote = ''
  if (args.bring_to_front && pid) {
    // 优先前置可见主窗；只带 pid 时驱动会选 pid 的第一个可见顶层窗口，
    // 单进程多窗口（Notepad 主窗/另存为同 pid）可能选错。
    const frontPayload = { pid, ...(windowId ? { window_id: windowId } : {}) }
    const front = await cuaCall('bring_to_front', frontPayload).catch((e) => ({ error: String(e?.message || e) }))
    const refusal = engineRefusal(front)
    if (refusal) {
      frontNote = `；启动成功，但前置未确认：${refusal}`
    } else if (isUnverified(front) || (front && typeof front === 'object' && front.effect === 'unverifiable')) {
      frontNote = '；启动成功，但前置未确认（驱动未验证）'
    } else if (front && typeof front === 'object' && front.effect !== 'confirmed') {
      frontNote = `；启动成功，但前置未确认：${JSON.stringify(front).slice(0, 160)}`
    } else {
      frontNote = windowId ? '；已前置' : '；已前置（驱动按 pid 选择窗口）'
    }
  }

  const detail = typeof launched === 'string' ? launched : JSON.stringify(launched).slice(0, 600)
  return {
    // 启动本身成功就是成功；前置是可选步骤，失败只写注记（不再让模型误判为启动失败而重复启动）。
    ok: true,
    result: `应用已启动${pid ? `（pid=${pid}${windowId ? ` window_id=${windowId}` : ''}）` : ''}${frontNote}：${detail}`,
    pid,
    window_id: windowId,
  }
}
