/**
 * 引擎回执判定（共享）：驱动的"拒绝/失败"回执有多种形态，这里统一识别，
 * 避免各调用点各判一套、把拒绝当成成功上报。
 *
 * 实测依据：
 * - 2026-09-16：invoke_menu 在 Win11 记事本返回 {"refusal":{code:"menu_path_unavailable"}}，
 *   而调用方此前无条件报"已调用菜单路径"成功 → 模型据此继续下一步。
 * - 同一目标上 driver hotkey 的 UIA 加速器扫描 4s 超时（以异常抛出）。
 */

/** @returns {string|null} 拒绝原因文本（null = 正常回执） */
export function engineRefusal(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const effect = value.effect
    if (effect === 'refused' || effect === 'rejected' || effect === 'suspected_noop') {
      const code = value.code ? ` (${value.code})` : ''
      const reason = value.escalation?.reason || value.reason || value.message || ''
      return `${effect}${code}${reason ? ' ' + reason : ''}`
    }
    if (typeof value.error === 'string') return value.error.slice(0, 200)
    if (value.refusal && typeof value.refusal === 'object') {
      const rc = value.refusal.code ? ` (${value.refusal.code})` : ''
      const rm = String(value.refusal.message || value.refusal.reason || '').slice(0, 200)
      return `驱动拒绝${rc}${rm ? ' ' + rm : ''}`
    }
    // 驱动的能力/结果失败形态：ok:false / success:false / supported:false / 单独 error_code。
    // 这些过去会落到“成功”分支（clipboard 的 supported:false 最典型）。
    if (value.ok === false || value.success === false) {
      const code = value.error_code || value.code || ''
      const reason = value.reason || value.message || value.detail || ''
      return `ok:false${code ? ` (${code})` : ''}${reason ? ' ' + String(reason).slice(0, 200) : ''}`
    }
    if (value.supported === false) {
      const why = value.reason || value.message || 'driver reports supported:false'
      return `unsupported (${String(why).slice(0, 200)})`
    }
    if (typeof value.error_code === 'string' && value.error_code) {
      return `驱动错误 (${value.error_code}) ${String(value.detail || value.message || '').slice(0, 200)}`
    }
    if (value.code === 'invalid_arguments' || value.code === 'unavailable' || value.code === 'not_supported') {
      return `驱动拒绝 (${value.code}) ${String(value.detail || value.message || '').slice(0, 200)}`
    }
  }
  return null
}

/** 引擎"受理了但怀疑未生效"：不是成功，也不等同于明确拒绝；调用方应提示先观察再决定是否重试。 */
export function isSuspectedNoop(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.effect === 'suspected_noop')
}

/** 驱动的 UIA 加速器扫描超时：目标应用 UIA provider 无响应（该目标上组合键/菜单可能整体不可达）。 */
export function uiaAcceleratorTimeout(msg) {
  return /UIA accelerator scan exceeded|a UIA provider in the target app is likely unresponsive/i.test(String(msg || ''))
}

/**
 * XAML/WinUI 目标上组合键没有可匹配的 UIA AcceleratorKey（常见于命令藏在关闭的菜单里）。
 * 2026-11-14 t01 实测的正文：
 *   hotkey on a modern XAML / UWP target ... could not find a UIA AcceleratorKey ...
 *   ... PostMessage WM_KEYDOWN/UP is ignored by this target's input pipeline.
 * 返回 true 表示应改走“打开菜单 → 点菜单项”的控件路径，而不是重复按键。
 */
export function uiaAcceleratorUnavailable(msg) {
  return /could not find a UIA AcceleratorKey|modern XAML\s*\/\s*UWP target|PostMessage WM_KEYDOWN\/UP is ignored by this target/i
    .test(String(msg || ''))
}
