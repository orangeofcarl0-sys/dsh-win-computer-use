/**
 * dispatcher.js —— 工具面模式（surfaceMode）的常量与目录/路由辅助。
 *
 * 两种稳定工具面：
 *   dispatcher（默认）：computer_do + screen_observe；全部桌面工具隐藏在 dispatcher 后。
 *   hybrid：computer_do + screen_observe + 5 个高频原生工具；长尾隐藏在 dispatcher 后。
 *
 * 立场：tools 数组稳定 → DeepSeek/OpenAI/Anthropic 的 prompt cache 不会被工具层变化打断。
 * 实测（2026-11-09，opencode/deepseek-v4.1-flash）：dispatcher 模式 tools 不变，
 * 旧前缀命中 92%–99%；动态 enter 或 lazy search 改变 tools 时首击仅 0%–18%。
 */

/** 三种工具面模式；默认 dispatcher（2026-11-10 起 dynamic 已废弃）。 */
export const SURFACE_MODES = Object.freeze(['dispatcher', 'hybrid'])

/** 所有模式都直接可见的稳定入口。 */
export const STABLE_TOOLS = Object.freeze(['computer_do', 'screen_observe'])

/** hybrid 下常驻的原生高频工具（3–5 个；其余走 dispatcher）。 */
export const HOT_TOOLS = Object.freeze([
  'computer_click',
  'computer_type',
  'computer_key',
  'computer_scroll',
  'computer_verify',
])

/** 该模式下 apply 时直接注册的工具。 */
export function visibleToolsForMode(mode) {
  return mode === 'hybrid' ? [...STABLE_TOOLS, ...HOT_TOOLS] : [...STABLE_TOOLS]
}

/** 该模式下只能经 computer_do({action:'call'}) 调用的工具。 */
export function hiddenToolNames(mode, allNames) {
  const visible = new Set(visibleToolsForMode(mode))
  return allNames.filter((name) => !visible.has(name))
}

/** 紧凑签名：name(required, optional?)。 */
function signature(def) {
  const props = Object.keys(def.parameters?.properties || {})
  const required = new Set(def.parameters?.required || [])
  return `${def.name}(${props.map((p) => (required.has(p) ? p : `${p}?`)).join(',')})`
}

/**
 * 生成 catalog 行（按名称/描述关键词过滤；空 query = 全部，最多 20 个）。
 * @returns {{names:string[], lines:string[]}}
 */
export function catalogOf(defs, names, query = '') {
  const tokens = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hits = (tokens.length > 0
    ? names.filter((name) => {
      const d = defs.get(name)
      return d && tokens.some((t) => `${name} ${d.description || ''}`.toLowerCase().includes(t))
    })
    : names).slice(0, 20)
  return {
    names: hits,
    lines: hits.map((name) => signature(defs.get(name))),
  }
}
