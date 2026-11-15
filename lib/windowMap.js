/**
 * windowMap.js —— 最近一次 list_windows 的 window_id → pid 映射。
 *
 * 用途：L3 的 bring_to_front 恢复原前台时，驱动只返回 previous_fg_hwnd，
 * 而 bring_to_front 的参数要求 pid + window_id。观察流程本来就会 list_windows，
 * 顺手记住 pid 可以避免恢复时再付一次 ~2s 的驱动调用。
 * 只做缓存，不参与目标选择；window_id 仍由各工具自己校验。
 */
const byWindow = new Map()
const MAX = 512

/** 记录 list_windows 结果（忽略非法/空 id）。 */
export function rememberWindows(windows) {
  for (const w of windows || []) {
    const id = Number(w?.window_id)
    const pid = Number(w?.pid)
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(pid) || pid <= 0) continue
    byWindow.set(id, pid)
  }
  if (byWindow.size > MAX) {
    for (const key of [...byWindow.keys()].slice(0, byWindow.size - MAX)) byWindow.delete(key)
  }
}

/** 查 pid；未知返回 null。 */
export function pidOfWindow(id) {
  const n = Number(id)
  return Number.isFinite(n) ? (byWindow.get(n) ?? null) : null
}

/** 插件重新 apply / 测试隔离。 */
export function resetWindowMap() {
  byWindow.clear()
}
