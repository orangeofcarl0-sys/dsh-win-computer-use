/**
 * guard.js —— 动作前置守卫（无感自治姿态，0.4.0）。
 *
 * 立场（PLAN-usability-first §1）：易用无感、自动提权、极危敏感警告、仅作基本兜底。
 *   1. 区域限制：allowedApps 白名单（默认空 = 关闭），仍属"作用域"而非审批。
 *   2. 凭据硬保护：密码框永不让模型自动输入——computer_type 硬拒绝（唯一硬块）；
 *      其余动作放行并附凭据注记。
 *   3. 极危注记层：extremePatterns 配置命中 → 结果附注记警告，不阻断（默认空 = 零差异）。
 *   4. 快照 TTL / 无快照拒绝：snapshot.js（不变）。
 *
 * 0.4.0 变更：危险词审批网关整体删除（零打断）；归因改为注记 + harness 会话日志。
 */
import { getSnapshot, getInputUnconfirmed } from './snapshot.js'
import { isPasswordCandidate } from './roles.js'
import { canonicalKey } from './keyFallback.js'
import { nearestEntry } from './human.js'

const SAVE_WORD = /保存|另存为|save as|save/i

function isSaveIntent(toolName, args, snap) {
  if (toolName === 'computer_key') {
    const c = canonicalKey(args.key)
    return c === 'ctrl+s' || c === 'ctrl+shift+s'
  }
  if (toolName === 'computer_click' || toolName === 'computer_double_click' || toolName === 'computer_right_click') {
    if (args.element !== undefined && args.element !== null) {
      const e = snap?.entries?.get(Number(args.element))
      return Boolean(e && SAVE_WORD.test(String(e.label || '')))
    }
    if (args.x !== undefined && args.y !== undefined) {
      const e = nearestEntry(snap, args.x, args.y, 24)
      return Boolean(e && SAVE_WORD.test(String(e.label || '')))
    }
    return false
  }
  if (toolName === 'computer_menu') {
    let path = args.path
    if (typeof path === 'string') {
      try { path = JSON.parse(path) } catch { path = path.split(/[\/›>]+/).map((s) => s.trim()).filter(Boolean) }
    }
    return Array.isArray(path) && path.some((p) => SAVE_WORD.test(String(p || '')))
  }
  return false
}

/** 区域限制只约束"操作类"工具；观察/列表/启动为只读或无害，不受限。 */
const OPERATION_TOOLS = new Set([
  'computer_click', 'computer_double_click', 'computer_right_click',
  'computer_type', 'computer_key', 'computer_scroll', 'computer_drag',
  'computer_set_value',
])

/**
 * 统一动作前置守卫。
 * @param {object} cfg - 插件配置（allowedApps / extremeRes）
 * @param {string} toolName - 当前工具名
 * @param {object} args - 工具参数
 * @returns {{ok:boolean, reason?:string, note?:string}} 不通过给 reason；通过可附 note（注记，不阻断）
 */
export function guard(cfg, toolName, args) {
  const snap = getSnapshot()

  // 0. 所有操作类工具都必须先建立快照：无快照不得盲发到当前前台/驱动默认窗口。
  if (OPERATION_TOOLS.has(toolName) && !snap) {
    return { ok: false, reason: '[snapshot_missing] 没有可用的观察快照：请先调用 screen_observe 再执行动作。' }
  }

  // 1. 区域限制：allowedApps 非空时，操作类工具的快照窗口应用必须在白名单内
  if (OPERATION_TOOLS.has(toolName) && cfg.allowedApps && cfg.allowedApps.length > 0) {
    if (!cfg.allowedApps.includes(snap.appName)) {
      return {
        ok: false,
        reason: `区域限制：应用 "${snap.appName}" 不在允许操作列表（${cfg.allowedApps.join(' / ')}）中，已拒绝。`,
      }
    }
  }

  // 1.5 输入未确认门禁：只拦“保存意图”，允许 type/set_value、Ctrl+A/C/V/X/Z 修正。
  // 回读一致或同窗口 native/zoom 观察会清除该状态（见 observe.js/actions.js）。
  if (snap) {
    const unconfirmed = getInputUnconfirmed(snap.pid, snap.windowId)
    if (unconfirmed && isSaveIntent(toolName, args, snap)) {
      const lens = [
        unconfirmed.requestedLen != null ? `请求 ${unconfirmed.requestedLen} 字符` : '',
        unconfirmed.actualLen != null ? `回读 ${unconfirmed.actualLen} 字符` : '',
      ].filter(Boolean).join('，')
      return {
        ok: false,
        reason: `[input_unconfirmed] 上一次输入未确认（${unconfirmed.reason || '内容不可信'}${lens ? '；' + lens : ''}）。`
          + '保存已阻止：先 computer_type/set_value 修正并确认回读一致，或用 screen_observe(native)/screen_zoom 核对正文后再保存。'
          + 'Ctrl+A/C/V/X/Z、type、set_value 和非保存点击仍可用。',
      }
    }
  }

  // 2/3. 元素级检测（仅 element 编号模式可预知目标；坐标模式无法预知，靠快照 TTL 兜底）
  if (args.element !== undefined && args.element !== null && snap) {
    const info = snap.entries?.get(Number(args.element))
    const role = info?.role || ''
    const label = info?.label || ''
    const value = info?.value || ''

    // 凭据硬保护：跨平台三态判定（结构位 > 启发式；AX 结构化 / Windows UIA 启发式 / sidecar 结构位）
    const verdict = info?.is_password === true
      ? 'hard'
      : isPasswordCandidate({ role, label, value })
    if (verdict === 'hard') {
      if (toolName === 'computer_type' || toolName === 'computer_set_value') {
        return { ok: false, reason: '敏感输入保护：密码框拒绝自动输入——密码/密钥必须由用户本人输入。' }
      }
      return { ok: true, note: `（凭据保护注记：目标"${label || role}"为密码输入框，自动输入已被硬性禁止；本次 ${toolName} 放行。）` }
    }
    if (verdict === 'note') {
      return { ok: true, note: `（凭据保护注记：目标"${label || role}"疑似密码相关控件；涉及自动输入的操作请格外谨慎。）` }
    }

    // 极危注记（不阻断）：extremePatterns 命中 → 附加警告
    const extreme = extremeNote(cfg, label)
    if (extreme) return { ok: true, note: extreme }
  }

  return { ok: true }
}

/** 极危清单注记：命中返回警告字符串（附到结果，不阻断），未命中返回 null。 */
export function extremeNote(cfg, label) {
  const s = String(label || '')
  if (!s) return null
  const hit = (cfg.extremeRes || []).some((re) => re.test(s))
  return hit
    ? `（极危警告：目标"${s.slice(0, 60)}"命中极危清单（不可逆/高敏感），已照常执行——请核对结果。）`
    : null
}
