/**
 * keyFallback.js —— XAML/WinUI 组合键失败后的实验性控件回退。
 *
 * 背景（2026-11-14 t01 实测）：Win11 记事本这类 WinUI3 目标上，Ctrl+S 没有可匹配的
 * UIA AcceleratorKey（命令藏在关闭的“文件”菜单里），PostMessage 也被目标输入管线忽略。
 * 驱动会明确返回 `could not find a UIA AcceleratorKey`。此时重复按键没有意义，可靠路径是：
 *   点菜单栏项（文件/编辑）→ 观察弹出菜单 → 点具体菜单项（保存/另存为/全选/粘贴……）。
 *
 * 本模块只在显式开启 `xamlKeyFallback: auto` 时执行，并且只做“唯一、精确标签”的 token 点击：
 * - 只允许白名单组合；关闭/退出类永不回退；
 * - 目标窗口必须是快照窗口；同 pid 多窗口必须能唯一确定菜单项；
 * - 菜单栏项和菜单项都必须唯一、enabled、有 element_token；
 * - 任一步歧义/缺失立即停止，不猜坐标、不模糊匹配、不自动处理另存为/覆盖对话框。
 */
import { cuaCall, cuaDeliver, withSession, isBackgroundUnavailable, isForegroundUnavailable } from './cua.js'
import { engineRefusal } from './engine.js'
import { clearSnapshot, getSnapshot } from './snapshot.js'
import { rememberWindows } from './windowMap.js'
import { isMenuRole, isAppMenuBarLabel, menuStateOf } from './menu.js'

const MODS = new Set(['ctrl', 'cmd', 'alt', 'shift', 'fn'])

/** 规范化组合键：修饰键排序、别名归一，如 Shift+Ctrl+S → ctrl+shift+s。 */
export function canonicalKey(key) {
  const parts = String(key || '').toLowerCase().split('+').map((s) => s.trim()).filter(Boolean)
  const mods = [...new Set(parts.filter((p) => MODS.has(p)).map((p) => {
    if (p === 'control') return 'ctrl'
    if (p === 'command') return 'cmd'
    if (p === 'option') return 'alt'
    return p
  }))].sort()
  const main = parts.find((p) => !MODS.has(p)) || ''
  return [...mods, main].filter(Boolean).join('+')
}

/**
 * 白名单：只回退有确定菜单语义、且不会关闭/退出应用的组合。
 * label 数组按优先级排列，匹配时大小写无关、去首尾空白，但必须完全相等。
 */
const TARGETS = {
  'ctrl+s': { menu: ['文件', 'File', '檔案'], item: ['保存', 'Save'], hint: '保存' },
  'ctrl+shift+s': { menu: ['文件', 'File', '檔案'], item: ['另存为', '另存為', 'Save As', 'Save as'], hint: '另存为' },
  'ctrl+a': { menu: ['编辑', 'Edit', '編輯'], item: ['全选', '全選', 'Select All', 'Select all'], hint: '全选' },
  'ctrl+c': { menu: ['编辑', 'Edit', '編輯'], item: ['复制', '複製', 'Copy'], hint: '复制' },
  'ctrl+v': { menu: ['编辑', 'Edit', '編輯'], item: ['粘贴', '貼上', 'Paste'], hint: '粘贴' },
  'ctrl+x': { menu: ['编辑', 'Edit', '編輯'], item: ['剪切', '剪下', 'Cut'], hint: '剪切' },
  'ctrl+z': { menu: ['编辑', 'Edit', '編輯'], item: ['撤销', '撤消', '復原', 'Undo'], hint: '撤销' },
  'ctrl+f': { menu: ['编辑', 'Edit', '編輯'], item: ['查找', '尋找', 'Find'], hint: '查找' },
  'ctrl+n': { menu: ['文件', 'File', '檔案'], item: ['新建标签页', '新建窗口', 'New tab', 'New window', '新建', 'New'], hint: '新建' },
  'ctrl+o': { menu: ['文件', 'File', '檔案'], item: ['打开', '開啟', 'Open'], hint: '打开' },
}

export function isFallbackKey(key) {
  return Boolean(TARGETS[canonicalKey(key)])
}

/** 对话框内可尝试 press_key 的编辑类组合（hotkey 的 UIA 加速器扫描失败时）。 */
const DIALOG_PRESS_KEYS = new Set(['ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z'])
/**
 * WinUI 前台 press_key 回退白名单：只含已实测的 ctrl+a / alt+f。
 * 不含 alt+tab（foreground 会真实切走前台）；也不含 ctrl+c/v/x/z（剪贴板类交给菜单回退）。
 */
const PRESS_FALLBACK_KEYS = new Set(['ctrl+a', 'alt+f'])

/** 快照窗口是否有真正的应用菜单栏（对话框通常没有；系统菜单不算）。 */
export function snapshotHasMenuBar(snap) {
  if (!snap?.entries) return false
  for (const e of snap.entries.values()) {
    if (isMenuRole(e.role) && isAppMenuBarLabel(e.label)) return true
  }
  return false
}

const norm = (s) => String(s ?? '').trim().toLowerCase()
const labelIn = (label, labels) => labels.some((l) => norm(label) === norm(l))

/** 从 get_window_state / 快照条目里挑唯一菜单项；文本节点和重复 token 会被排除。 */
function pickMenuItem(elements, labels) {
  const all = (elements || []).filter((e) => e && labelIn(e.label ?? e.name, labels))
  const menuish = all.filter((e) => isMenuRole(e.role))
  const pool = menuish.length > 0 ? menuish : all
  const withToken = pool.filter((e) => e.element_token && e.enabled !== false)
  const byToken = new Map(withToken.map((e) => [e.element_token, e]))
  const unique = [...byToken.values()]
  if (unique.length === 1) return unique[0]
  if (unique.length > 1) return { ambiguous: true, count: unique.length, labels: unique.map((e) => e.label ?? e.name) }
  return null
}

async function listWindows() {
  const v = await cuaCall('list_windows', { on_screen_only: true })
  rememberWindows(v?.windows || [])
  return (v?.windows || []).filter((w) => w && w.window_id && (w.title || w.app_name))
}

async function windowState(pid, windowId) {
  try {
    return await cuaCall('get_window_state', withSession({
      pid, window_id: windowId, include_screenshot: false, max_elements: 200,
    }))
  } catch {
    return null
  }
}

/**
 * 在所有同 pid 窗口里找唯一目标菜单项（菜单可能已在主窗口或独立的弹出窗口里）。
 * 返回 { item, window } / { none:true } / { ambiguous:true, detail }。
 */
async function findVisibleItem(snap, target, windows) {
  const samePid = windows.filter((w) => Number(w.pid) === Number(snap.pid))
  const ordered = samePid.slice().sort((a, b) => {
    if (Number(a.window_id) === Number(snap.windowId)) return -1
    if (Number(b.window_id) === Number(snap.windowId)) return 1
    return (Number(b.z_index) || 0) - (Number(a.z_index) || 0)
  }).slice(0, 6)
  const byToken = new Map()
  for (const w of ordered) {
    const st = await windowState(w.pid, w.window_id)
    if (!st) continue
    const hit = pickMenuItem(st.elements, target.item)
    if (!hit) continue
    if (hit.ambiguous) return { ambiguous: true, detail: `“${target.hint}”菜单项不唯一：${hit.labels.join(' / ')}` }
    byToken.set(hit.element_token, { item: hit, window: w })
  }
  if (byToken.size === 0) return { none: true }
  if (byToken.size > 1) return { ambiguous: true, detail: `“${target.hint}”在多个窗口中出现且 token 不同` }
  return [...byToken.values()][0]
}

/**
 * 前台 press_key 回退：hotkey 的 UIA 加速器不可达时，经 SendInput 发送组合键。
 * 只用 foreground（background 会把裸键插进 WinUI 正文）；带 pid/window_id，
 * 让 cuaDeliver 在 foreground_unavailable 时能精确 L3 前置并恢复。
 * 返回 null 表示组合键本身无法解析（不适用）；否则一定返回 ok:true/false 回执。
 */
async function tryForegroundPressKey(snap, canonical, { opensMenu = false } = {}) {
  const parts = canonical.split('+')
  const main = parts.find((p) => !MODS.has(p))
  const modifiers = parts.filter((p) => MODS.has(p))
  if (!main) return null
  const successGuidance = opensMenu
    ? '请 screen_observe 查看弹出的菜单，再点具体菜单项；不要重复按 alt+f。'
    : '请 screen_observe 确认输入框当前值；若未变，优先 computer_set_value(element=编号, value=完整内容) 覆盖；不支持 ValuePattern 时再点击+清空后 computer_type。'
  let reason = ''
  try {
    const { value } = await cuaDeliver('press_key', withSession({
      key: main, modifiers, pid: snap.pid, window_id: snap.windowId,
    }), 'foreground', { forceForeground: true })
    const refusal = engineRefusal(value)
    if (refusal) reason = refusal
    else if (isForegroundUnavailable(value)) reason = '前台锁/前置校验拦截（foreground_unavailable）'
    else if (isBackgroundUnavailable(value)) reason = '目标拒绝按键投递（background_unavailable）'
    else {
      // alt+f 会打开菜单、改变 UI 结构：清快照，强制重新观察取菜单项编号。
      // ctrl+a 只改变选区，token 仍有效，不清。
      if (opensMenu) clearSnapshot()
      return {
        ok: true,
        result: `按键未送达（XAML/WinUI 无 UIA 加速键）；已按 xamlPressFallback=auto 用前台 press_key 发送 ${canonical}（未验证）。` + successGuidance,
      }
    }
  } catch (err) {
    reason = String(err?.message || err).split('\n')[0].slice(0, 160)
  }
  const failGuidance = opensMenu
    ? '请改用 screen_observe → 点击“文件”菜单栏项；不要重复按 alt+f。'
    : '请点击目标输入框（element=编号）后优先 computer_set_value(element=编号, value=完整内容) 覆盖；不支持 ValuePattern 时再清空后 computer_type；不要重复按 ctrl+a。'
  return {
    ok: false,
    result: `按键未送达（XAML/WinUI 无 UIA 加速键）；前台 press_key 也未能发送 ${canonical}（${reason || '未确认'}）。${failGuidance}`,
  }
}

async function clickToken(pid, windowId, token) {
  const payload = { pid, element_token: token, count: 1, button: 'left' }
  if (windowId !== undefined && windowId !== null) payload.window_id = Number(windowId)
  const { value } = await cuaDeliver('click', withSession(payload), 'background')
  const refusal = engineRefusal(value)
  if (refusal) {
    if (/stale_element_token|stale element token/i.test(refusal)) clearSnapshot()
    return { ok: false, reason: `点击被引擎拒绝：${refusal}` }
  }
  if (isBackgroundUnavailable(value)) return { ok: false, reason: '目标拒绝后台点击（background_unavailable）' }
  if (isForegroundUnavailable(value)) return { ok: false, reason: '前台锁拦截（foreground_unavailable）' }
  return { ok: true }
}

/**
 * 实验性自动回退入口。返回 null 表示不适用（调用方走普通指引）。
 * @param {{key:string, cfg:object}} opts
 * @returns {Promise<{ok:boolean,result:string}|null>}
 */
export async function tryXamlKeyFallback({ key, cfg, foreground = false }) {
  const canonical = canonicalKey(key)
  const target = TARGETS[canonical]
  // 两条独立开关：菜单 token 回退（xamlKeyFallback）与前台 press 回退（xamlPressFallback）。
  // alt+f 没有菜单项目标，只能由 press 回退处理；ctrl+a 两者都有。
  const menuEnabled = cfg?.xamlKeyFallback === 'auto' && Boolean(target)
  const pressEnabled = cfg?.xamlPressFallback === 'auto' && PRESS_FALLBACK_KEYS.has(canonical)
  if (!menuEnabled && !pressEnabled) return null
  const snap = getSnapshot()
  if (!snap) {
    return { ok: false, result: '自动回退未执行：没有可用的观察快照；请先 screen_observe。' }
  }
  // 不因 snap.suspect 直接拒绝：2026-11-15 t01 实测 click 的 unverifiable 会标 suspect，
  // 紧接着的 Ctrl+A 回退被这里拦住，模型只能“观察→点击→Ctrl+A 被拒”循环。
  // 回退本身会重新校验窗口存在并读取当前菜单项 token；失败仍会返回明确原因。
  const windows = await listWindows()
  const main = windows.find((w) => Number(w.window_id) === Number(snap.windowId))
  if (!main) {
    return { ok: false, result: `自动回退未执行：快照窗口 window_id=${snap.windowId} 已不在可见窗口列表中；请重新观察。` }
  }

  // alt+f 没有“文件→目标项”的 TARGETS 目标：用一次前台 press_key 打开文件菜单。
  // 先看快照里是否已有弹出菜单项，避免把已打开的菜单关掉。
  if (canonical === 'alt+f') {
    const menu = menuStateOf([...(snap.entries?.values?.() || [])])
    if (menu.open === true) {
      return {
        ok: false,
        result: '自动回退未执行：当前窗口已检测到弹出菜单项（菜单可能已打开）。'
          + '请先 screen_observe，直接点菜单项；不要重复按 alt+f。',
      }
    }
    return tryForegroundPressKey(snap, canonical, { opensMenu: true })
  }

  // 只开 press 回退（菜单回退关闭）：直接前台按键，不再走菜单点击。
  if (!menuEnabled) {
    return tryForegroundPressKey(snap, canonical)
  }

  // 菜单可能已经打开：先找现成的目标菜单项，避免再点菜单栏把它关掉。
  let found = await findVisibleItem(snap, target, windows)
  if (found.ambiguous) {
    if (pressEnabled) {
      const tried = await tryForegroundPressKey(snap, canonical)
      if (tried) return tried
    }
    return { ok: false, result: `自动回退未执行：${found.detail}；请先 screen_observe 并用 computer_click(element=编号) 手动选择。` }
  }
  if (!found.none) {
    const clicked = await clickToken(main.pid, main.window_id, found.item.element_token)
    if (!clicked.ok) {
      return { ok: false, result: `自动回退失败：${clicked.reason}。请先 screen_observe 后手动点“${target.hint}”。` }
    }
    clearSnapshot()
    return {
      ok: true,
      result: `按键未送达（XAML/WinUI 无 UIA 加速键）；已自动回退：菜单已打开，直接点击“${target.hint}”菜单项（后台，未验证）。请 screen_observe 确认结果。`,
    }
  }

  // 菜单栏 token 必须重新抓：findVisibleItem 已经对同 pid 窗口调用过
  // get_window_state，旧快照 token 已失效（实测“打开文件菜单时 stale_element_token”）。
  const freshMain = await windowState(snap.pid, snap.windowId)
  const menuHit = freshMain ? pickMenuItem(freshMain.elements, target.menu) : null
  if (menuHit && menuHit.ambiguous) {
    if (pressEnabled) {
      const tried = await tryForegroundPressKey(snap, canonical)
      if (tried) return tried
    }
    return {
      ok: false,
      result: `自动回退未执行：当前窗口“${target.menu[0]}”菜单栏项不唯一：${menuHit.labels.join(' / ')}。`
        + '请先 screen_observe，再用 computer_click(element=<菜单栏项编号>) 手动打开菜单。',
    }
  }
  if (!menuHit) {
    // 没有菜单栏的目标通常是对话框（另存为/打开/属性）。这里不能再说“去点编辑菜单”：
    // 对话框里正确的恢复路径是前台按键，或点击输入框后用 computer_type。
    const alreadyFg = foreground === true || cfg?.deliveryMode === 'foreground'
    // 实验性：hotkey 的 UIA 加速器扫描失败，但 press_key+modifiers 经 SendInput
    // 可能到达 Win32 编辑框（另存为文件名框就是这种）。对编辑类组合直接尝试一次；
    // 不再要求调用方先传 foreground=true——否则模型会“点击→Ctrl+A 被拒→再观察”循环。
    // xamlPressFallback=auto 时也允许 ctrl+a 在这里兜底。
    if (pressEnabled || DIALOG_PRESS_KEYS.has(canonical)) {
      const tried = await tryForegroundPressKey(snap, canonical)
      if (tried) return tried
    }
    return {
      ok: false,
      result: `自动回退未执行：当前窗口没有“${target.menu[0]}”菜单栏，更像对话框。`
        + (alreadyFg
          ? `${target.hint} 已在前台通道发送过 ${String(key)} 但仍未生效：请点击目标输入框（element=编号），`
            + '再用 computer_type(element=编号, text=完整内容) 输入。'
          : `${target.hint} 请先用 foreground=true 重试 ${String(key)}；或 foreground 点击目标输入框后用 computer_type 输入。`)
        + '不要用三连击或连续退格来猜状态。',
    }
  }
  const menuClick = await clickToken(snap.pid, snap.windowId, menuHit.element_token)
  if (!menuClick.ok) {
    // 菜单栏点击失败时菜单大概率没打开；press 回退可以安全再试一次。
    if (pressEnabled) {
      const tried = await tryForegroundPressKey(snap, canonical)
      if (tried) return tried
    }
    return { ok: false, result: `自动回退失败：打开“${target.menu[0]}”菜单时${menuClick.reason}。请先 screen_observe 后手动点击菜单项。` }
  }
  clearSnapshot()

  // 等待弹出菜单出现；只认唯一 token，歧义即停。
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 250))
    const wins = await listWindows()
    found = await findVisibleItem(snap, target, wins)
    if (found.ambiguous) {
      return { ok: false, result: `自动回退停止：${found.detail}。菜单可能已打开，请 screen_observe 后手动点“${target.hint}”。` }
    }
    if (found.none) continue
    const clicked = await clickToken(found.window.pid, found.window.window_id, found.item.element_token)
    if (!clicked.ok) {
      return { ok: false, result: `自动回退失败：点击“${target.hint}”时${clicked.reason}。请 screen_observe 后手动重试。` }
    }
    return {
      ok: true,
      result: `按键未送达（XAML/WinUI 无 UIA 加速键）；已自动回退：点击“${target.menu[0]}”菜单 → “${target.hint}”菜单项（后台，未验证）。`
        + '请 screen_observe 确认结果；若弹出另存为/覆盖对话框，请按对话框提示继续，不要重复按组合键。',
    }
  }
  return {
    ok: false,
    result: `自动回退未完成：已点击“${target.menu[0]}”菜单，但没有找到唯一的“${target.hint}”菜单项。`
      + '菜单可能已打开——先 screen_observe 查看弹出菜单，再点具体项；不要重复按组合键。',
  }
}

/** 默认（off）或回退不适用时的模型指引；不透传驱动的 get_window_state 建议。 */
export function xamlKeyGuidance(key, kind = 'no-accelerator', { hasMenuBar = true } = {}) {
  const canonical = canonicalKey(key)
  const target = TARGETS[canonical]
  const why = kind === 'timeout'
    ? '目标应用的 UIA provider 无响应，组合键通道 4s 超时'
    : 'XAML/WinUI 目标没有可匹配的 UIA 加速键，命令通常藏在关闭的菜单里'
  if (!hasMenuBar) {
    return `按键未送达（${why}）：当前窗口没有可用的菜单栏，更像对话框。`
      + `请点击目标输入框（element=编号）后优先 computer_set_value(element=编号, value=完整内容) 覆盖；`
      + `不支持 ValuePattern 时再清空后 computer_type；不要重复按 ${String(key)}，也不要用三连击/连续退格猜状态。`
  }
  if (canonical === 'alt+f') {
    return `按键未送达（${why}）：不要重复按 ${String(key)}。`
      + '请改走控件：screen_observe 取编号 → 点击“文件”菜单栏项 → 重新 screen_observe → 点击目标菜单项（标签以实际观察为准）。'
      + 'Alt+Tab 也不要用（foreground 会真的切走前台）；切窗口请用 app_launch/bring_to_front。'
  }
  const steps = target
    ? `请改走控件：screen_observe 取编号 → 点击“${target.menu[0]}”菜单栏项 → 重新 screen_observe → 点击“${target.hint}”菜单项（标签以实际观察为准）。`
    : '请改走控件：screen_observe 取编号 → 点击界面上的菜单/按钮完成同一操作（标签以实际观察为准）。'
  const saveNote = canonical === 'ctrl+s'
    ? '若文档未命名，“保存”会弹出另存为对话框；请在对话框中填写完整路径并点保存。'
    : ''
  return `按键未送达（${why}）：不要重复按 ${String(key)}。${steps}${saveNote}`
}
