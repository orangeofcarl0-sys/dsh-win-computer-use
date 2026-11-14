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

const norm = (s) => String(s ?? '').trim().toLowerCase()
const labelIn = (label, labels) => labels.some((l) => norm(label) === norm(l))
const isMenuRole = (role) => /menu|菜单/i.test(String(role || ''))

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

async function clickToken(pid, token) {
  const { value } = await cuaDeliver('click', withSession({
    pid, element_token: token, count: 1, button: 'left',
  }), 'background')
  const refusal = engineRefusal(value)
  if (refusal) return { ok: false, reason: `点击被引擎拒绝：${refusal}` }
  if (isBackgroundUnavailable(value)) return { ok: false, reason: '目标拒绝后台点击（background_unavailable）' }
  if (isForegroundUnavailable(value)) return { ok: false, reason: '前台锁拦截（foreground_unavailable）' }
  return { ok: true }
}

/**
 * 实验性自动回退入口。返回 null 表示不适用（调用方走普通指引）。
 * @param {{key:string, cfg:object}} opts
 * @returns {Promise<{ok:boolean,result:string}|null>}
 */
export async function tryXamlKeyFallback({ key, cfg }) {
  if (cfg?.xamlKeyFallback !== 'auto') return null
  const canonical = canonicalKey(key)
  const target = TARGETS[canonical]
  if (!target) return null
  const snap = getSnapshot()
  if (!snap) {
    return { ok: false, result: '自动回退未执行：没有可用的观察快照；请先 screen_observe。' }
  }
  if (snap.suspect) {
    return { ok: false, result: '自动回退未执行：当前快照已被标记为不确定；请先 screen_observe 复核。' }
  }

  const windows = await listWindows()
  const main = windows.find((w) => Number(w.window_id) === Number(snap.windowId))
  if (!main) {
    return { ok: false, result: `自动回退未执行：快照窗口 window_id=${snap.windowId} 已不在可见窗口列表中；请重新观察。` }
  }

  // 菜单可能已经打开：先找现成的目标菜单项，避免再点菜单栏把它关掉。
  let found = await findVisibleItem(snap, target, windows)
  if (found.ambiguous) {
    return { ok: false, result: `自动回退未执行：${found.detail}；请先 screen_observe 并用 computer_click(element=编号) 手动选择。` }
  }
  if (!found.none) {
    const clicked = await clickToken(main.pid, found.item.element_token)
    if (!clicked.ok) {
      return { ok: false, result: `自动回退失败：${clicked.reason}。请先 screen_observe 后手动点“${target.hint}”。` }
    }
    clearSnapshot()
    return {
      ok: true,
      result: `按键未送达（XAML/WinUI 无 UIA 加速键）；已自动回退：菜单已打开，直接点击“${target.hint}”菜单项（后台，未验证）。请 screen_observe 确认结果。`,
    }
  }

  // 从快照里找唯一菜单栏项（文件/编辑）。
  const entries = [...snap.entries.entries()].map(([index, e]) => ({ index, ...e }))
  const menuHits = entries.filter((e) => e.token && labelIn(e.label, target.menu) && isMenuRole(e.role))
  const menuByToken = new Map(menuHits.map((e) => [e.token, e]))
  if (menuByToken.size === 0) {
    // 没有菜单栏的目标通常是对话框（另存为/打开/属性）。这里不能再说“去点编辑菜单”：
    // 对话框里正确的恢复路径是前台重试按键，或点击输入框后前台输入。
    return {
      ok: false,
      result: `自动回退未执行：当前窗口没有“${target.menu[0]}”菜单栏，更像对话框。`
        + `${target.hint} 请先用 foreground=true 重试 ${String(key)}；或 foreground 点击目标输入框后用 foreground computer_type 输入。`
        + '不要用三连击或连续退格来猜状态。',
    }
  }
  if (menuByToken.size > 1) {
    return {
      ok: false,
      result: `自动回退未执行：快照里存在多个“${target.menu[0]}”菜单栏项。`
        + '请先 screen_observe，再用 computer_click(element=<菜单栏项编号>) 手动打开菜单。',
    }
  }
  const menuClick = await clickToken(snap.pid, [...menuByToken.values()][0].token)
  if (!menuClick.ok) {
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
    const clicked = await clickToken(found.window.pid, found.item.element_token)
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
export function xamlKeyGuidance(key, kind = 'no-accelerator') {
  const canonical = canonicalKey(key)
  const target = TARGETS[canonical]
  const why = kind === 'timeout'
    ? '目标应用的 UIA provider 无响应，组合键通道 4s 超时'
    : 'XAML/WinUI 目标没有可匹配的 UIA 加速键，命令通常藏在关闭的菜单里'
  const steps = target
    ? `请改走控件：screen_observe 取编号 → 点击“${target.menu[0]}”菜单栏项 → 重新 screen_observe → 点击“${target.hint}”菜单项（标签以实际观察为准）。`
    : '请改走控件：screen_observe 取编号 → 点击界面上的菜单/按钮完成同一操作（标签以实际观察为准）。'
  const saveNote = canonical === 'ctrl+s'
    ? '若文档未命名，“保存”会弹出另存为对话框；请在对话框中填写完整路径并点保存。'
    : ''
  return `按键未送达（${why}）：不要重复按 ${String(key)}。${steps}${saveNote}`
}
