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
import { markConsumed, markSuspect } from './snapshot.js'

/**
 * 引擎仅"回执未验证"（unverifiable）时的注记。
 * 2026-11-15 t01 实证：旧措辞“必要时 foreground=true 重试”被模型理解成“默认前台”，
 * 导致每次点击多 5 次 move_cursor（15–18s）。改为“先观察；界面已变勿重复”。
 */
export const UNVERIFIED_NOTE = '（未验证：先 screen_observe 一次；界面已变勿重复；确认未变再考虑 foreground=true 重试。）'

/** 引擎"受理了但怀疑未生效"时的注记：先观察，不要立即重放非幂等动作。 */
export const SUSPECTED_NOOP_NOTE = '（引擎判定“可能未生效”：不要立即重复同一动作；先 screen_observe 确认界面，再决定是否重试。）'

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
export function settleAction(tool, vRaw, { label, key = '', note = '', preNote = '', gateNote = '', refusalNote = '', verbose = false } = {}) {
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
    return {
      ok: false,
      result: `${label}未送达：${why}。不要重复同一动作；先 screen_observe 确认界面，`
        + '必要时对本次动作加 foreground=true 重试一次。' + preNote + note,
    }
  }
  if (refusal) {
    // suspected_noop 可能已经下发过，不能当"未消费"让后续动作复用旧快照；标记可疑但不消费。
    if (suspectedNoop) markSuspect(tool)
    return refusalReceipt(label, refusal, preNote + note + refusalNote + (suspectedNoop ? SUSPECTED_NOOP_NOTE : ''))
  }
  const unverified = isUnverified(value)
  return {
    ok: true,
    result: receipt(label, value, {
      key,
      note,
      extraNote: preNote + (unverified ? UNVERIFIED_NOTE : '') + gateNote,
      unverified,
      verbose,
    }),
  }
}
