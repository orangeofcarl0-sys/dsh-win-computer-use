/**
 * menuPath.js —— 菜单路径解析（computer_menu / guard 共用）。
 *
 * 模型常写 "文件/保存"、"文件->保存"、"文件→保存"；统一归一化为逐级数组。
 * 数组项做 trim（空白是噪声）；JSON 字符串优先按 JSON 解析，双重编码的字符串再走一次分隔符。
 * fail-closed：无法解析就报错并给四种示例，绝不猜层级。
 */
const SEPARATORS = /\s*(?:->|→|[\/›>])\s*/
const EXAMPLES = '示例：["文件","保存"]、"文件/保存"、"文件->保存" 或 "文件→保存"'

/** 解析菜单路径；失败抛错。 */
export function parseMenuPath(raw) {
  let path = raw
  if (typeof path === 'string') {
    try {
      path = JSON.parse(path)
    } catch (err) {
      if (SEPARATORS.test(path)) {
        path = path.split(SEPARATORS)
      } else {
        throw new Error(`path 不是合法 JSON 或可解析的菜单路径：${err.message}（${EXAMPLES}）`)
      }
    }
    // JSON.parse 可能返回字符串（双重编码）；再按分隔符切一次。
    if (typeof path === 'string') path = path.split(SEPARATORS)
  }
  if (!Array.isArray(path)) throw new Error(`path 必须是字符串数组或分隔字符串（${EXAMPLES}）。`)
  const parts = path.map((s) => String(s ?? '').trim()).filter(Boolean)
  if (parts.length === 0) throw new Error(`path 至少需要 1 级菜单名（${EXAMPLES}）。`)
  return parts
}

/** 非抛出包装：guard 只关心“能否解析成保存意图”，解析失败按无意图处理。 */
export function tryParseMenuPath(raw) {
  try {
    return parseMenuPath(raw)
  } catch {
    return null
  }
}
