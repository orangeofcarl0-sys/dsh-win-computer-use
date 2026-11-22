/**
 * policy.js —— 自治策略契约：auto / locked / guarded 的确定性判定。
 *
 * 立场：语义层借官方 CUA 的“身份、作用域、撤销、审计”，交互层坚持本仓库的
 * “用户无感、自动作用、基本安全”。因此：
 *   - auto（默认）：零 userQuestions；blockedApps 拒绝，sensitiveApps 只读，
 *     子 Agent 默认不能移动真实指针；
 *   - locked：只允许 allowedApps 内的应用；禁真实指针/委派；无 allowedApps 时 fail-closed；
 *   - guarded（显式 opt-in）：只对 sensitiveApps 操作与真实指针做会话级询问，
 *     子 Agent 不能询问，服务缺失/取消一律 fail-closed。
 *
 * evaluatePolicy 是纯函数：不读全局快照、不 spawn、不网络、不询问；
 * 运行时只由调用方传入 snapshot/args/origin。resolvePolicyDecision 只处理
 * guarded 的 userQuestions 与进程内会话缓存。
 */

const MODES = new Set(['auto', 'locked', 'guarded'])

/** 需要应用身份才能套用 blockedApps / sensitiveApps / allowedApps 的动作。 */
const APP_ACTION_TOOLS = new Set([
  'computer_click', 'computer_double_click', 'computer_right_click',
  'computer_type', 'computer_key', 'computer_scroll', 'computer_drag',
  'computer_set_value', 'computer_menu', 'computer_activate', 'computer_hover',
])

/** locked 模式下额外拒绝的非应用动作（剪贴板读写可能泄露/篡改）。 */
const LOCKED_DENY_TOOLS = new Set(['computer_clipboard'])

const APPROVAL_LABELS = Object.freeze({
  appApprove: '允许本会话',
  appReject: '拒绝',
  pointerApprove: '允许本会话',
  pointerReject: '拒绝',
})

/** guarded 会话缓存：approval.key -> 'allow' | 'deny'。仅进程内，apply/stop 清空。 */
const sessionDecisions = new Map()

/** 清空 guarded 的会话级批准（apply / computer_stop 调用）。 */
export function resetPolicySession() {
  sessionDecisions.clear()
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const s = item.trim()
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

/**
 * 归一化 autonomy 配置；嵌套默认值在这里补齐（宿主/测试 harness 可能只给部分字段）。
 * locked 是预设：强制禁真实指针、禁委派、禁子 Agent 真实指针。
 */
export function normalizeAutonomy(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const sub = r.subagents && typeof r.subagents === 'object' ? r.subagents : {}
  const mode = MODES.has(r.mode) ? r.mode : 'auto'
  const locked = mode === 'locked'
  return {
    mode,
    blockedApps: stringList(r.blockedApps),
    sensitiveApps: stringList(r.sensitiveApps),
    realPointer: locked || r.realPointer === 'deny' ? 'deny' : 'auto',
    subagents: {
      realPointer: locked || sub.realPointer !== 'inherit' ? 'deny' : 'inherit',
      delegation: locked || sub.delegation === 'deny' ? 'deny' : 'allow',
    },
  }
}

function sameWindow(snapshot, args) {
  if (!snapshot) return false
  if (args?.pid !== undefined && args.pid !== null && Number(args.pid) !== Number(snapshot.pid)) return false
  if (args?.window_id !== undefined && args.window_id !== null && Number(args.window_id) !== Number(snapshot.windowId)) return false
  return true
}

/** 从快照/启动参数解析应用身份；无法确认时返回空串（不做猜测）。 */
function appIdentity(tool, args, snapshot) {
  if (tool === 'app_launch') return typeof args?.name === 'string' ? args.name.trim() : ''
  if (!APP_ACTION_TOOLS.has(tool)) return ''
  if (!sameWindow(snapshot, args)) return ''
  return typeof snapshot?.appName === 'string' ? snapshot.appName : ''
}

function deny(code, reason, extra = {}) {
  return { decision: 'deny', rule: code, code, reason: `[${code}] ${reason}`, ...extra }
}

function ask(code, reason, approval, extra = {}) {
  return { decision: 'ask', rule: code, code, reason: `[${code}] ${reason}`, approval, ...extra }
}

function allow(rule = 'default') {
  return { decision: 'allow', rule }
}

/**
 * 纯策略判定。
 * @param {object} cfg - 插件内部 cfg（读取 autonomy / allowedApps）
 * @param {object} input - { tool, args, snapshot, origin }
 * @returns {{decision:'allow'|'deny'|'ask', rule:string, code?:string, app?:string, reason?:string, approval?:object}}
 */
export function evaluatePolicy(cfg, { tool, args = {}, snapshot = null, origin = 'main' } = {}) {
  const autonomy = cfg?.autonomy || normalizeAutonomy()
  const allowedApps = Array.isArray(cfg?.allowedApps) ? cfg.allowedApps : []
  const a = args && typeof args === 'object' ? args : {}
  const mode = autonomy.mode
  const app = appIdentity(tool, a, snapshot)
  const appAction = APP_ACTION_TOOLS.has(tool) || tool === 'app_launch'
  const subagent = origin === 'subagent'

  // 1. locked：只允许 allowedApps；无 allowlist 时所有应用动作 fail-closed。
  if (mode === 'locked') {
    if (tool === 'computer_task') {
      return deny('policy_delegation_denied', 'locked 模式禁止 computer_task 委派。')
    }
    if (LOCKED_DENY_TOOLS.has(tool)) {
      return deny('policy_locked', 'locked 模式拒绝剪贴板读写。')
    }
    if (appAction) {
      if (allowedApps.length === 0) {
        return deny('policy_locked_no_allowlist',
          'locked 模式要求 allowedApps 非空；当前为空，所有应用操作已拒绝（观察仍可用）。', { app })
      }
      if (!app) {
        return deny('policy_locked', 'locked 模式无法确认目标应用在 allowedApps 内，已拒绝。')
      }
      if (!allowedApps.includes(app)) {
        return deny('policy_locked', `应用 "${app}" 不在 allowedApps 内；locked 模式已拒绝。`, { app })
      }
    }
  }

  // 2. blockedApps：永久拒绝该应用的操作；观察仍可用。
  if (appAction && app && autonomy.blockedApps.includes(app)) {
    return deny('policy_blocked_app',
      `应用 "${app}" 在 autonomy.blockedApps 中；观察仍可用，操作已拒绝。`, { app })
  }

  // 3. 现有 allowedApps 作用域：补齐 guard 未覆盖的 menu/hover/activate/launch。
  if (appAction && allowedApps.length > 0) {
    if (!app) {
      return deny('policy_not_allowlisted',
        'allowedApps 非空，但当前动作无法确认目标应用；已拒绝。')
    }
    if (!allowedApps.includes(app)) {
      return deny('policy_not_allowlisted', `应用 "${app}" 不在 allowedApps 内；已拒绝。`, { app })
    }
  }

  // 4. sensitiveApps：auto/locked 只读；guarded 会话级询问。
  if (appAction && app && autonomy.sensitiveApps.includes(app)) {
    if (mode === 'guarded') {
      return ask('policy_sensitive_app',
        `应用 "${app}" 在 autonomy.sensitiveApps 中；本会话是否允许操作？`, {
          key: `app:${app}`,
          kind: 'app',
          app,
          question: `允许本会话操作应用 "${app}" 吗？`,
          detail: '仅本次 dsh 会话有效；不会保存。拒绝后本会话不再询问。',
          approve: APPROVAL_LABELS.appApprove,
          reject: APPROVAL_LABELS.appReject,
        }, { app })
    }
    return deny('policy_sensitive_app',
      `应用 "${app}" 在 autonomy.sensitiveApps 中；${mode} 模式只读，操作已拒绝。`
      + '要操作请切到 guarded 或把应用移出 sensitiveApps。', { app })
  }

  // 5. 真实指针：子 Agent 默认 deny；locked/显式 deny 一律拒绝；guarded 会话级询问。
  if (tool === 'computer_hover' && a.real === true) {
    if (subagent && autonomy.subagents.realPointer === 'deny') {
      return deny('policy_subagent_pointer',
        '子 Agent 不能移动真实鼠标指针；请用虚拟悬停/点击，或由主 Agent 执行。')
    }
    if (autonomy.realPointer === 'deny') {
      return deny('policy_real_pointer_denied',
        'autonomy.realPointer=deny；真实指针已拒绝，虚拟悬停仍可用。')
    }
    if (mode === 'guarded') {
      if (subagent) {
        return deny('policy_subagent_pointer', '子 Agent 不能申请真实指针权限。')
      }
      return ask('policy_real_pointer', '本会话是否允许移动真实鼠标指针？', {
        key: 'pointer:real',
        kind: 'pointer',
        question: '允许本会话移动真实鼠标指针吗？',
        detail: '仅本次 dsh 会话有效；不会保存。拒绝后本会话不再询问。',
        approve: APPROVAL_LABELS.pointerApprove,
        reject: APPROVAL_LABELS.pointerReject,
      })
    }
  }

  // 6. 委派：子 Agent 不能再次委派；locked/显式 deny 拒绝。
  if (tool === 'computer_task') {
    if (subagent) {
      return deny('policy_delegation_denied', '子 Agent 不能再委派 computer_task。')
    }
    if (autonomy.subagents.delegation === 'deny') {
      return deny('policy_delegation_denied', 'autonomy.subagents.delegation=deny；已拒绝委派。')
    }
  }

  return allow()
}

function approvalSubject(approval) {
  return approval?.kind === 'app' && approval.app ? `应用 "${approval.app}"` : '真实指针'
}

/**
 * 处理 guarded 的 ask：会话缓存 → 子 Agent 拒绝 → userQuestions 询问 → 缓存结果。
 * auto/locked 不会产生 ask，因此本函数默认不会调用 userQuestions。
 * @param {object} ctx - Cordis 上下文（取 userQuestions）
 * @param {object} exec - 工具执行上下文（agent/signal）
 * @param {object} decision - evaluatePolicy 返回的 ask 决策
 * @returns {Promise<{ok:boolean, code?:string, reason?:string}>}
 */
export async function resolvePolicyDecision(ctx, exec, decision) {
  if (!decision || decision.decision !== 'ask') return { ok: true }
  const approval = decision.approval
  if (!approval?.key) {
    return { ok: false, code: 'policy_approval_unavailable',
      reason: '[policy_approval_unavailable] 策略询问缺少审批标识，已拒绝。' }
  }

  const cached = sessionDecisions.get(approval.key)
  if (cached === 'allow') return { ok: true }
  if (cached === 'deny') {
    return { ok: false, code: 'policy_approval_denied',
      reason: `[policy_approval_denied] 本会话已拒绝${approvalSubject(approval)}。` }
  }

  if (exec?.agent?.session?.header?.origin === 'subagent') {
    return { ok: false, code: 'policy_approval_unavailable',
      reason: '[policy_approval_unavailable] 子 Agent 不能请求用户批准；请由主 Agent 操作。' }
  }

  const questions = ctx?.get?.('userQuestions')
  if (!questions || typeof questions.ask !== 'function') {
    return { ok: false, code: 'policy_approval_unavailable',
      reason: '[policy_approval_unavailable] guarded 模式需要 userQuestions 服务；当前不可用，已拒绝。' }
  }
  const agent = exec?.agent
  if (!agent) {
    return { ok: false, code: 'policy_approval_unavailable',
      reason: '[policy_approval_unavailable] 缺少 agent 上下文，无法请求批准。' }
  }

  const id = approval.kind === 'app' ? 'cua-policy-app' : 'cua-policy-pointer'
  try {
    const result = await questions.ask({
      agent,
      signal: exec?.signal,
      questions: [{
        id,
        question: approval.question,
        detail: approval.detail,
        options: [{ label: approval.approve }, { label: approval.reject }],
        intent: {
          kind: 'approval',
          approve: approval.approve,
          reject: approval.reject,
          ...(approval.kind === 'app' && approval.app ? { subject: { name: approval.app } } : {}),
        },
      }],
    })
    const answer = Array.isArray(result?.answers)
      ? result.answers.find((item) => item?.id === id)
      : null
    const allowed = Boolean(answer
      && !String(answer.custom || '').trim()
      && Array.isArray(answer.selected)
      && answer.selected.length === 1
      && answer.selected[0] === approval.approve)
    sessionDecisions.set(approval.key, allowed ? 'allow' : 'deny')
    if (allowed) return { ok: true }
    return { ok: false, code: 'policy_approval_denied',
      reason: `[policy_approval_denied] 用户拒绝了${approvalSubject(approval)}的本会话权限。` }
  } catch (error) {
    if (String(error?.code || '') === 'ASK_CANCELLED') {
      sessionDecisions.set(approval.key, 'deny')
      return { ok: false, code: 'policy_approval_cancelled',
        reason: '[policy_approval_cancelled] 用户取消了策略询问；本次操作已拒绝。' }
    }
    return { ok: false, code: 'policy_approval_unavailable',
      reason: `[policy_approval_unavailable] 策略询问失败：${String(error?.message || error).slice(0, 160)}` }
  }
}

/** `computer_do status` 的一行策略摘要。 */
export function describePolicy(cfg) {
  const a = cfg?.autonomy || normalizeAutonomy()
  const allowed = Array.isArray(cfg?.allowedApps) ? cfg.allowedApps.length : 0
  return `策略：${a.mode}（blockedApps=${a.blockedApps.length}，sensitiveApps=${a.sensitiveApps.length}，`
    + `realPointer=${a.realPointer}，subagents.realPointer=${a.subagents.realPointer}，`
    + `delegation=${a.subagents.delegation}，allowedApps=${allowed}）`
}
