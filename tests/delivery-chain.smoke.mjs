/**
 * 离线冒烟：真实三级投递升级链（deliveryMode='auto'）。
 *
 * P0-0（2026-11-09）：此前本测试把整个 lib/cua.js 替换成一份 cuaDeliver 复刻实现，
 * 实际测的是复刻而不是生产代码。现在 cuaDeliver 支持 opts.call 注入，本测试直接
 * 导入真实 lib/cua.js，用假 call 驱动，覆盖：
 *   A. background 拒 → foreground 前台锁拒 → bring_to_front 绕锁 → 成功 → 恢复原前台
 *   B. hotkey 的 XAML 先验拒绝（非 JSON 抛错）→ 不升级、不 bring_to_front
 *   C. 正常成功 → 零升级注记
 *   D. unverifiable + 指针类 → L3，且 bring_to_front 的 target 带 window_id
 *   E. deliveryMode=background 强制后台 → 单次调用
 *   F. background 拒 → foreground 成功 → L2 注记
 *   G. bring_to_front 未返回 previous_fg_hwnd → 明确提示未恢复
 *   H. 无 pid + 前台锁拒 → 不尝试 L3
 */
import { cuaDeliver } from '../lib/cua.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const freshHistory = () => []
const payload = (extra = {}) => ({
  session: 'smoke', pid: 100, window_id: 7, delivery_mode: 'background', ...extra,
})

// ── A: 完整 L1 → L2 → L3 → 恢复 ─────────────────────────────────────
{
  const history = freshHistory()
  const call = async (tool, args = {}) => {
    history.push({ tool, args })
    if (tool === 'bring_to_front') return { previous_fg_hwnd: 111, now_fg_hwnd: 222 }
    if (tool === 'scroll') {
      if (args.delivery_mode === 'background') {
        return { code: 'background_unavailable', escalation: { recommended: 'foreground' } }
      }
      // 第一次 foreground 被前台锁拦截；bring_to_front 之后第二次成功。
      if (history.filter((c) => c.tool === 'bring_to_front').length === 0) {
        return { code: 'foreground_unavailable', reason: 'target window was not foreground' }
      }
      return { effect: 'confirmed', delivery: { mode: 'foreground' } }
    }
    return {}
  }
  const r = await cuaDeliver('scroll', payload(), 'auto', { call })
  const chain = history.map((c) => c.tool + (c.args.window_id !== undefined ? '@' + c.args.window_id : ''))
  check('A: 三级链触发并恢复原前台', /bring_to_front 绕锁/.test(r.note) && /已恢复原前台/.test(r.note), chain.join(' -> '))
  check('A: bring_to_front 使用 payload 的 window_id', history.some((c) => c.tool === 'bring_to_front' && c.args.window_id === 7))
  check('A: 恢复调用指向 previous_fg_hwnd', history.at(-1)?.tool === 'bring_to_front' && history.at(-1)?.args.window_id === 111)
}

// ── B: hotkey XAML 先验拒绝 → 不升级 ────────────────────────────────
{
  const history = freshHistory()
  const call = async (tool, args = {}) => {
    history.push({ tool, args })
    if (tool === 'hotkey') {
      if (args.delivery_mode === 'background') {
        return { code: 'background_unavailable', escalation: { recommended: 'foreground' } }
      }
      throw new Error('could not find a UIA AcceleratorKey or (Ctrl+X)-style name hint')
    }
    return {}
  }
  const r = await cuaDeliver('hotkey', payload({ keys: ['ctrl', 'x'] }), 'auto', { call })
  check('B: hotkey 前置拒绝不触发 bring_to_front', !history.some((c) => c.tool === 'bring_to_front'), `calls=${history.length}`)
  check('B: 错误被规范化为结构化回执', /UIA AcceleratorKey/.test(JSON.stringify(r.value)))
}

// ── C: 正常成功 → 零升级 ─────────────────────────────────────────────
{
  const history = freshHistory()
  const call = async (tool, args = {}) => {
    history.push({ tool, args })
    return { effect: 'confirmed', delivery: { mode: 'background' } }
  }
  const r = await cuaDeliver('click', payload(), 'auto', { call })
  check('C: 正常成功零升级注记', r.note === '' && history.length === 1, `calls=${history.length}`)
}

// ── D: unverifiable + 指针类 → L3，target 带 window_id ────────────────
{
  const history = freshHistory()
  const call = async (tool, args = {}) => {
    history.push({ tool, args })
    if (tool === 'bring_to_front') return { previous_fg_hwnd: 111 }
    if (tool === 'click') {
      return args.delivery_mode === 'background'
        ? { effect: 'unverifiable', delivery: { mode: 'background' } }
        : { effect: 'confirmed', delivery: { mode: 'foreground' } }
    }
    return {}
  }
  const r = await cuaDeliver('click', payload(), 'auto', { call })
  const btf = history.find((c) => c.tool === 'bring_to_front')
  check('D: unverifiable 触发 L3 且注入 window_id', /绕锁/.test(r.note) && btf?.args.window_id === 7,
    history.map((c) => c.tool).join(' -> '))
}

// ── E: 强制后台 → 单次调用、无升级 ───────────────────────────────────
{
  const history = freshHistory()
  const call = async (tool, args = {}) => {
    history.push({ tool, args })
    return { code: 'background_unavailable', escalation: { recommended: 'foreground' } }
  }
  const r = await cuaDeliver('scroll', payload(), 'background', { call })
  check('E: deliveryMode=background 只调一次', history.length === 1 && r.note === '', `calls=${history.length}`)
}

// ── F: background 拒 → foreground 成功（L2）──────────────────────────
{
  const history = freshHistory()
  const call = async (tool, args = {}) => {
    history.push({ tool, args })
    return args.delivery_mode === 'background'
      ? { code: 'background_unavailable', escalation: { recommended: 'foreground' } }
      : { effect: 'confirmed', delivery: { mode: 'foreground' } }
  }
  const r = await cuaDeliver('type_text', payload({ text: 'hi' }), 'auto', { call })
  check('F: L2 成功并附注记', /已前台重试一次/.test(r.note) && history.length === 2, `calls=${history.length}`)
}

// ── G: bring_to_front 未确认 → 明确提示 ───────────────────────────────
{
  const history = freshHistory()
  const call = async (tool, args = {}) => {
    history.push({ tool, args })
    if (tool === 'bring_to_front') return {}
    return (args.delivery_mode === 'background'
      ? { code: 'background_unavailable' }
      : { code: 'foreground_unavailable' })
  }
  const r = await cuaDeliver('scroll', payload(), 'auto', { call })
  check('G: 未返回 previous_fg_hwnd → 明说未恢复', /未确认成功，原前台未恢复/.test(r.note), r.note.trim())
}

// ── H: 无 pid + 前台锁拒 → 不尝试 L3 ────────────────────────────────
{
  const history = freshHistory()
  const call = async (tool, args = {}) => {
    history.push({ tool, args })
    return (args.delivery_mode === 'background'
      ? { code: 'background_unavailable' }
      : { code: 'foreground_unavailable' })
  }
  const r = await cuaDeliver('scroll', payload({ pid: undefined }), 'auto', { call })
  check('H: 无 pid 不做 bring_to_front', !history.some((c) => c.tool === 'bring_to_front') && /前台锁拦截/.test(r.note),
    `calls=${history.length}`)
}

console.log(`\n结果：${failures ? '❌ ' + failures + ' 项失败' : '✅ 全部通过'}`)
process.exit(failures ? 1 : 0)
