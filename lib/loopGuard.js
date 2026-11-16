/**
 * loopGuard.js —— 重复点击抑制（2026-11-15 t01 轨迹驱动）。
 *
 * 实测：模型在“回执 unverifiable + 界面未变”时会连续点同一目标（同一保存按钮 1.2s 内两次、
 * 同一文件菜单 3 次）。这类重复不产生新信息，只放大指针移动与上下文。
 *
 * 规则（保守）：
 * - 只作用于 computer_click / computer_right_click（double_click 有明确语义，不拦）；
 * - 同一窗口 + 同一目标 + 同一投递模式 + 同一 count，5s 内重复；
 * - 期间只要有一次观察明确报告“界面发生变化”，立即清除该窗口的重复计数并放行；
 * - 目标/投递模式/count 任一不同 → 视为不同动作，放行；
 * - 配置 actionGuard=off 可完全关闭。
 */
import { describeClickTarget } from './human.js'

const POINTER_TOOLS = new Set(['computer_click', 'computer_right_click'])
const WINDOW_MS = 5000
const last = new Map()   // `${windowKey}|${signature}` -> { at, label }

function windowKeyOf(snap) {
  return `${snap.pid}:${snap.windowId}`
}

function signatureOf(toolName, args) {
  const target = args.element !== undefined && args.element !== null
    ? `el:${args.element}`
    : `xy:${args.x},${args.y}`
  const count = Number(args.count) || 1
  const delivery = args.foreground === true ? 'fg' : 'bg'
  // from_zoom 的 x/y 是 zoom 图像坐标，与窗口坐标同值时仍可能是不同目标。
  const space = args.from_zoom === true ? '|fz' : ''
  // Ctrl+click 与普通 click 是不同手势；不区分会被 repeat_suppressed 误伤。
  const mod = Array.isArray(args.modifier) && args.modifier.length
    ? `|mod:${[...args.modifier].map(String).sort().join('+')}`
    : ''
  return `${toolName}|${target}|${count}|${delivery}${space}${mod}`
}

/** 插件重新 apply / 会话重置。 */
export function resetLoopGuard() {
  last.clear()
}

/**
 * 观察结果回写：changed=true 时清除该窗口的重复计数（有进展，允许继续操作）。
 * changed=false/null 时保留计数：下一次相同点击仍会被抑制。
 */
export function noteObserveChange(windowKey, changed) {
  if (!windowKey || changed !== true) return
  const prefix = `${windowKey}|`
  for (const k of [...last.keys()]) {
    if (k.startsWith(prefix)) last.delete(k)
  }
}

/**
 * 点击前检查。
 * @returns {{ok:false,result:string}|null} null = 放行
 */
export function checkRepeat(toolName, args, snap, cfg) {
  if (cfg?.actionGuard === 'off') return null
  if (!POINTER_TOOLS.has(toolName) || !snap) return null
  const windowKey = windowKeyOf(snap)
  const sig = `${windowKey}|${signatureOf(toolName, args)}`
  const now = Date.now()
  const prev = last.get(sig)
  if (prev && now - prev.at <= WINDOW_MS) {
    const age = Math.max(1, Math.round((now - prev.at) / 1000))
    const label = prev.label ? `（目标 ${prev.label}）` : ''
    return {
      ok: false,
      result: `✗ [repeat_suppressed] 与 ${age}s 前的相同点击重复${label}，且期间没有观察到界面变化。`
        + '请先 screen_observe 确认当前界面；若确认要再次点击，请换目标、加 count=2、改 modifier，或先处理界面状态。',
    }
  }
  last.set(sig, { at: now, label: describeClickTarget(snap, args) })
  return null
}
