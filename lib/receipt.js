/**
 * receipt.js —— 动作回执的统一出口（PLAN-context-budget C，结构治理 P1-6）。
 *
 * 两条立场：
 *  1. 回执随历史每步重发，正常路径只回一行要点（原始 JSON 只在拒绝/未验证/verboseReceipts 时附上）。
 *  2. **"引擎拒绝"只有一个出口**：驱动的拒绝形态有 {effect:'refused'}、{error}、{refusal:{code}}、
 *     {code:'invalid_arguments'} 多种，散落各工具判断必然漏（menu/scroll/drag 都栽过同一坑：
 *     拒绝被上报成功，模型据此继续下一步）。settleAction 把"判拒绝 → 标记快照消费 → 出回执"
 *     收成一处，新工具只要走它就不会再漏。
 */
import { deliveryFailure, isUnverified, normalizeMcp } from './cua.js'
import { engineRefusal, isSuspectedNoop } from './engine.js'
import { clearSnapshot, markConsumed, markSuspect } from './snapshot.js'

/**
 * 引擎仅"回执未验证"（unverifiable）时的注记。
 * 2026-11-15 t01 实证：旧措辞“必要时 foreground=true 重试”被模型理解成“默认前台”，
 * 导致每次点击多 5 次 move_cursor（15–18s）。改为“先观察；界面已变勿重复”。
 */
export const UNVERIFIED_NOTE = '（未验证：先 screen_observe 一次；界面已变勿重复；确认未变再考虑 foreground=true 重试。）'

/** 输入类（type/set_value）的未验证注记：回读优先，禁止 foreground 重输同一文本。 */
export const INPUT_UNVERIFIED_NOTE = '（输入未验证：先回读/核对正文；不要用 foreground 重输同一段文本；界面已变勿重复。）'

/**
 * 文档类输入的置脏说明（2026-11-16 WinUI 实测）：
 * UIA 文本注入可以写入正文但不置“未保存”标记；模型不能据此判断输入失败，
 * 更不要用查找替换/重复输入去“强制置脏”。
 */
export const DOCUMENT_INPUT_NOTE = '（文档输入说明：UIA 文本注入可能不置“未保存”标记——标题星号不出现、标签页仍显示“未修改”都属正常；不要据此判断输入失败，也不要为制造星号插入 SPACE/BACKSPACE、重复输入或查找替换；直接保存即可写入。）'

/** set_value 的持久化说明：ValuePattern 可能不置脏，不代表已落盘。 */
export const SET_VALUE_NOTE = '（设值说明：ValuePattern 覆盖写入；部分应用不会置“未保存”标记——不要据此判断失败；保存前用回读/观察核对正文。）'

/** 引擎"受理了但怀疑未生效"时的注记：先观察，不要立即重放非幂等动作。 */
export const SUSPECTED_NOOP_NOTE = '（引擎判定“可能未生效”：不要立即重复同一动作；先 screen_observe 确认界面，再决定是否重试。）'

/** 通用失败纠正提示：只描述下一步，不改变目标/不自动重试。 */
const REFUSAL_HINTS = {
  screenshot_context_missing: '（截图上下文缺失：先 screen_zoom 或 screen_observe 重新建立截图上下文，再重试；本次未发送动作。）',
  window_target_not_found: '（目标窗口可能已关闭/最小化/被对话框覆盖：先 screen_observe 取最新 window_id，再 computer_activate；本次未发送动作。）',
  target_not_found: '（目标窗口可能已关闭或不可见：先 screen_observe 取最新 window_id，再重试；本次未发送动作。）',
}

function refusalCodeOf(value) {
  if (!value || typeof value !== 'object') return ''
  return String(value.code || value.refusal?.code || value.error_code || '')
}

/**
 * 顶层菜单栏点击未验证时的专用注记：菜单状态无法从点击回执判断，
 * 重复点同一菜单栏项会把已打开的菜单关掉（2026-11-16 菜单路径实测）。
 */
export const MENU_CLICK_NOTE = '（菜单栏点击未验证：菜单可能已打开也可能未打开；不要重复点同一菜单栏项（会把已打开的菜单关掉）。先 screen_observe：看到弹出菜单项就直接点；没有再用 foreground=true 重试一次，或改用 computer_menu。）'

/** 紧凑回执：一行要点（label(+key)完成 · 投递 · 效果）+ 注记；明细仅在必要时附上。 */
export function receipt(label, value, { key = '', note = '', extraNote = '', verbose = false, unverified = false } = {}) {
  const delivery = value && typeof value === 'object' ? value.delivery?.mode : undefined
  const effect = value && typeof value === 'object' ? value.effect : undefined
  const bits = [label + (key ? `(${key})` : '') + '完成']
  if (delivery) bits.push(delivery === 'foreground' ? '前台' : '后台')
  if (effect === 'confirmed') bits.push('已确认')
  else if (effect && effect !== 'unverified') bits.push(String(effect))
  const head = bits.join(' · ')
  const detail = verbose || unverified || !effect
    ? `：${typeof value === 'string' ? value : JSON.stringify(value)}`
    : ''
  return `${head}${detail}${note}${extraNote}`
}

/** 引擎拒绝的统一回执。 */
export function refusalReceipt(label, refusal, note = '') {
  return { ok: false, result: `${label}被引擎拒绝：${refusal}${note}` }
}

/**
 * 驱动调用超时（DriverCallError.kind='timeout'）的统一回执。
 * 超时意味着“结果未知”，不是“未送达”：点击可能已触发模态对话框，输入可能已部分写入。
 * ctx：{targetGone, candidates:[{window_id,title}]}，由 index.js 在超时后廉价 list_windows 得到。
 * 回执只给下一步，不自动重试非幂等动作。
 */
export function timeoutReceipt(toolName, err, ctx = {}) {
  const detail = String(err?.message || err).slice(0, 200)
  const head = `✗ ${toolName} 超时：${detail}。`
  const name = String(toolName || '')
  const preflight = err?.tool === 'bring_to_front'
  const notes = []
  if (ctx.targetGone) {
    notes.push('目标窗口已从窗口列表消失：上一次动作很可能已生效（可能延迟）。不要重试；先 screen_observe 确认最终状态。')
  }
  const candidates = Array.isArray(ctx.candidates) ? ctx.candidates.slice(0, 3) : []
  if (candidates.length > 0) {
    const list = candidates.map((c) => {
      const id = c.window_id ?? c.windowId
      const title = String(c.title || '').replace(/\s+/g, ' ').slice(0, 40) || '(无标题)'
      return `${title} window_id=${id}`
    }).join('；')
    notes.push(`同 pid 的更高层窗口：${list}；下一步 screen_observe(window_id=<id>)，不要先 computer_activate。`)
  }
  const context = notes.join('')
  if (/click|double_click|right_click/.test(name)) {
    const lead = preflight
      ? '前置激活超时，本次点击未发送。'
      : '点击结果未知：本次点击可能已触发模态对话框，或目标 UIA 无响应。'
    return head + lead + context
      + '不要重复点击、改像素坐标、zoom 或 drag；对话框上不要后台坐标点击（会再次 30s）。'
      + '先 screen_observe 当前窗口；优先 keyboard：Escape=取消(No)、Enter=默认按钮（Yes/确定），普通键加 foreground=true 只发一次；'
      + '若必须点击，只在最新快照上 foreground=true 点一次。若没有新对话框，先观察确认状态，再决定是否重试。'
  }
  if (/type|set_value/.test(name)) {
    return head + '输入结果未知：目标可能已部分写入。不要重复输入同一段文本；先 screen_observe/回读确认已写入的部分，再补齐缺失内容。' + context
  }
  if (/key|hotkey/.test(name)) {
    return head + '按键结果未知：目标可能已收到，也可能仍停在模态对话框。' + context
      + '不要重复按同一键或连续换键（Enter→Space→…），也不要盲点坐标；先等待并 screen_observe 检查对话框是否已消失；'
      + '若仍在，用 foreground=true 只发一次 Escape 或 Tab/Enter；每次按键后观察。'
  }
  if (/drag/.test(name)) {
    return head + '拖拽结果未知：本次手势可能已执行。若起点在标题栏，窗口可能已被移动；先重新 screen_observe，不要重复同一手势。' + context
  }
  if (/activate/.test(name)) {
    return head + '激活结果未知：窗口可能仍存在但无法前置；不要重复 activate。' + context
      + '先 screen_observe 目标窗口；模态对话框优先直接观察它并用键盘。'
  }
  if (/observe|zoom|verify|wait_for/.test(name)) {
    return head + '观察/UIA 通道无响应：不要重复同一观察；先 screen_observe(window=<标题子串>) 看候选/前台提示，换一个 window_id 或稍后重试一次。' + context
  }
  if (/menu/.test(name)) {
    return head + '菜单调用未确认：不要重复同一路径；先 screen_observe 看菜单是否已打开，未打开就点菜单栏项。' + context
  }
  return head + '动作结果未知：不要重复同一动作；先 screen_observe 确认界面状态，再决定是否重试一次。' + context
}

/**
 * 动作收尾（所有动作工具共用）：规范化回执 → 判定引擎拒绝 → 成功则标记快照已消费（不可验证另标可疑）。
 * @param {string} tool - 工具名（用于快照消费标记，如 'click' / 'type_text'）
 * @param {any} vRaw - cuaDeliver 返回的原始回执
 * @param {object} o - { label, key?, note?, preNote?, gateNote?, refusalNote?, verbose? }
 *   note：投递注记（成功与拒绝两条路径都附）；preNote/refusalNote：工具专属补充；
 *   gateNote：快照新鲜度注记（成功路径附）。
 * @returns {{ok:boolean, result:string}}
 */
export function settleAction(tool, vRaw, { label, key = '', note = '', preNote = '', gateNote = '', refusalNote = '', inputKind = '', unverifiedNote = '', verbose = false } = {}) {
  const value = normalizeMcp(vRaw)
  const refusal = engineRefusal(value)
  const suspectedNoop = isSuspectedNoop(value)
  const delivery = refusal ? null : deliveryFailure(value)
  if (!refusal && !delivery) {
    markConsumed(tool)
    if (isUnverified(value)) markSuspect(tool)
  }
  if (delivery) {
    // 投递失败不是成功：目标很可能没有收到输入。不要消费快照（允许前台重试），
    // delivery_failed 状态不确定，另标 suspect。
    if (delivery === 'delivery_failed') markSuspect(tool)
    const why = delivery === 'background'
      ? '目标拒绝后台投递（background_unavailable）'
      : delivery === 'foreground'
        ? '前台锁/前置校验拦截（foreground_unavailable）'
        : '驱动报告投递失败（delivery_failed）'
    const retry = inputKind === 'type'
      ? '输入类动作可能已部分写入：不要重复输入同一段文本；先回读/观察确认缺失部分再补齐。'
      : inputKind === 'set_value'
        ? '改用 computer_type(element=编号) 重试，或点击后输入。'
        : '不要重复同一动作；先 screen_observe 确认界面，必要时对本次动作加 foreground=true 重试一次。'
    const deliveryHint = delivery === 'foreground'
      ? '（目标可能被其他窗口/对话框覆盖：先 screen_observe 取最新 window_id，再 computer_activate；不要重复输入。）'
      : ''
    return {
      ok: false,
      result: `${label}未送达：${why}。${retry}` + preNote + note + deliveryHint,
    }
  }
  if (refusal) {
    // 驱动的 element token 已失效：旧快照里的编号不能再复用。清空快照，让下一次动作
    // 直接得到 [snapshot_missing] 而不是用另一个旧编号继续撞 stale_element_token。
    const stale = /stale_element_token|stale element token/i.test(refusal)
    if (stale) clearSnapshot()
    if (suspectedNoop) markSuspect(tool)
    const staleNote = stale
      ? '（[stale_element_token] 编号已失效，旧快照已清空；请 screen_observe 获取新编号，不要重试旧编号。）'
      : ''
    const hint = REFUSAL_HINTS[refusalCodeOf(value)] || ''
    return refusalReceipt(label, refusal, preNote + note + refusalNote + staleNote + hint + (suspectedNoop ? SUSPECTED_NOOP_NOTE : ''))
  }
  const unverified = isUnverified(value)
  const inputNote = inputKind === 'set_value' ? SET_VALUE_NOTE : ''
  const unverifiedText = inputKind
    ? INPUT_UNVERIFIED_NOTE
    : (unverifiedNote || UNVERIFIED_NOTE)
  return {
    ok: true,
    result: receipt(label, value, {
      key,
      note,
      extraNote: preNote + (unverified ? unverifiedText : '') + inputNote + gateNote,
      unverified,
      verbose,
    }),
  }
}
