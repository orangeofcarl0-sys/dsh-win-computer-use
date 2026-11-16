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
    return {
      ok: false,
      result: `${label}未送达：${why}。${retry}` + preNote + note,
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
    return refusalReceipt(label, refusal, preNote + note + refusalNote + staleNote + (suspectedNoop ? SUSPECTED_NOOP_NOTE : ''))
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
