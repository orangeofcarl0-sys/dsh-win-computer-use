/**
 * menu.js —— 菜单角色/标签的共享判定。
 *
 * 观察头部、XAML 回退、点击回执过去各有一套正则；这里统一，避免
 * “顶层菜单栏被当成弹出菜单”“系统菜单算应用菜单栏”之类的漂移。
 */

const MENU_ROLE = /menu|菜单/i
/** 顶层菜单栏标签（含 Windows 系统菜单）；这些不是弹出菜单项。 */
const TOP_MENU_LABEL = /^(文件|编辑|查看|插入|格式|工具|帮助|file|edit|view|insert|format|tools|help|系统|system)$/i
/** 应用菜单栏标签（不含系统菜单）；用于“窗口是否有应用菜单栏”的判断。 */
const APP_MENU_BAR_LABEL = /^(文件|编辑|查看|插入|格式|工具|帮助|file|edit|view|insert|format|tools|help)$/i

export function isMenuRole(role) {
  return MENU_ROLE.test(String(role || ''))
}

export function isTopMenuBarLabel(label) {
  return TOP_MENU_LABEL.test(String(label ?? '').trim())
}

export function isAppMenuBarLabel(label) {
  return APP_MENU_BAR_LABEL.test(String(label ?? '').trim())
}

function listOf(elements) {
  if (!elements) return []
  if (Array.isArray(elements)) return elements
  if (typeof elements.values === 'function') return [...elements.values()]
  return []
}

/**
 * 同一窗口内的菜单态启发式（不扫描独立 popup 窗口）：
 * - open=true：非顶层菜单项 >= 3（与观察头部文案一致）；
 * - open=false：有应用菜单栏，但没有任何非顶层菜单项（更像菜单未打开）；
 * - open=null：无法判断（1-2 个疑似项，或完全没有菜单信息）。
 * 注意：false 只代表“本窗口未看到弹出项”，不排除独立 popup 窗口。
 */
export function menuStateOf(elements) {
  let count = 0
  let hasAppBar = false
  for (const e of listOf(elements)) {
    if (!isMenuRole(e?.role)) continue
    const label = e?.label ?? e?.name ?? ''
    if (isTopMenuBarLabel(label)) {
      if (isAppMenuBarLabel(label)) hasAppBar = true
      continue
    }
    count++
  }
  return {
    count,
    hasAppBar,
    open: count >= 3 ? true : (hasAppBar && count === 0 ? false : null),
  }
}
