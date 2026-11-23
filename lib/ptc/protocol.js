/**
 * protocol.js —— PTC 桥接的协议校验与稳定错误。
 *
 * 这层只做三件事：
 *   1. 校验官方风格的 { method, params }，拒绝未知键/越界值；
 *   2. 把内层工具的中文回执映射成稳定错误码；
 *   3. 维护能力矩阵：core（已实现）/ probe（只读 UIA 探针后决定）/
 *      diagnostic（本轮明确不做，返回结构化诊断）。
 *
 * 不 import 宿主包，不读驱动；tool.js 负责真正的执行。
 */

/** 应用句柄：pid:<number>，由 getApp 合成。 */
export const APP_HANDLE_PREFIX = 'pid:'

/** 官方 raw 方法名（含本轮不支持的方法，便于返回结构化诊断）。 */
export const METHOD_NAMES = Object.freeze([
  'getCapabilities', 'listApps', 'findApps', 'getApp',
  'listWindows', 'getState', 'activate',
  'listActions', 'invoke', 'setValue', 'typeText', 'pressKey', 'mouseMove',
  'click', 'drag', 'screenshot',
  'show', 'scroll', 'selectText', 'performAction', 'paste', 'sendKeyEvent',
])

/** 本轮已实现、可宣告的方法。 */
export const CORE_METHODS = Object.freeze([
  'getCapabilities', 'listApps', 'findApps', 'getApp',
  'listWindows', 'getState', 'activate',
  'listActions', 'invoke', 'setValue', 'typeText', 'pressKey', 'mouseMove',
  'click', 'drag', 'screenshot', 'show', 'scroll', 'performAction',
])

/**
 * 能力矩阵。status:
 *   core       = 本轮可用；
 *   probe      = 等待 evals/probe-uia-patterns 的只读结果，本轮返回诊断；
 *   diagnostic = 本轮没有忠实路径，返回诊断与替代建议。
 */
export const METHOD_SUPPORT = Object.freeze({
  getCapabilities: { status: 'core' },
  listApps: { status: 'core' },
  findApps: { status: 'core' },
  getApp: { status: 'core' },
  listWindows: { status: 'core' },
  getState: { status: 'core' },
  activate: { status: 'core' },
  listActions: { status: 'core' },
  invoke: { status: 'core' },
  setValue: { status: 'core' },
  typeText: { status: 'core' },
  pressKey: { status: 'core' },
  mouseMove: { status: 'core' },
  click: { status: 'core' },
  drag: { status: 'core' },
  screenshot: { status: 'core' },
  show: {
    status: 'core',
    reason: 'Win32 SW_SHOWNOACTIVATE 非激活恢复；少数应用可能自行激活，结果如实报告 foregroundChanged。',
  },
  scroll: {
    status: 'core',
    reason: 'UIA ScrollPattern 点滚动；目标点没有可滚 pattern 时返回 CAPABILITY_UNAVAILABLE 与替代路径。',
  },
  performAction: {
    status: 'core',
    reason: '仅支持 Invoke 与 ValuePattern.SetValue；Expand/Collapse/SelectionItem/Toggle/Focus 返回诊断。',
    alternatives: ['invoke()', 'setValue()', 'click()'],
  },
  selectText: {
    status: 'probe',
    reason: '需要 UIA TextPattern；当前驱动没有 select_text 工具，需先确认目标控件 TextPattern 覆盖。',
    alternatives: ['setValue()', 'click() + pressKey("ctrl+a")'],
  },
  paste: {
    status: 'probe',
    reason: '需要剪贴板保存/恢复 + Paste 命令；用 typeText 代替会丢剪贴板语义，不能静默近似。',
    alternatives: ['typeText()', 'computer_do({action:"call",tool:"computer_clipboard"})'],
  },
  sendKeyEvent: {
    status: 'probe',
    reason: '需要单次 key-down/key-up；现有 computer_key 成对发送，不能拆成半事件。',
    alternatives: ['pressKey()'],
  },
})

/** 稳定错误：message 带 CODE 前缀，details 保留机器可读字段。 */
export class PtcError extends Error {
  constructor(code, message, details = undefined) {
    super(`${code}: ${message}`)
    this.name = 'PtcError'
    this.code = code
    this.details = details
  }
}

function fail(message, details = undefined) {
  throw new PtcError('INVALID_ARGUMENT', message, details)
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function checkKeys(params, allowed, method) {
  const unknown = Object.keys(params).filter((k) => !allowed.includes(k))
  if (unknown.length) {
    fail(`${method} 不接受参数 ${unknown.join(', ')}；允许：${allowed.join(', ') || '无'}`, { method, unknown })
  }
}

function reqString(params, key, method, { min = 1 } = {}) {
  const v = params[key]
  if (typeof v !== 'string' || v.length < min) fail(`${method}.${key} 需要非空字符串`, { method, key })
  return v
}

function optString(params, key, method) {
  if (params[key] === undefined) return undefined
  if (typeof params[key] !== 'string') fail(`${method}.${key} 需要字符串`, { method, key })
  return params[key]
}

function reqInt(params, key, method, { min = 1, max = 2 ** 31 - 1 } = {}) {
  const v = params[key]
  if (!Number.isInteger(v) || v < min || v > max) fail(`${method}.${key} 需要 ${min}..${max} 的整数`, { method, key })
  return v
}

function optInt(params, key, method, opts) {
  if (params[key] === undefined) return undefined
  return reqInt(params, key, method, opts)
}

function optNumber(params, key, method, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (params[key] === undefined) return undefined
  const v = params[key]
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    fail(`${method}.${key} 需要 ${min}..${max} 的数字`, { method, key })
  }
  return v
}

function optBool(params, key, method) {
  if (params[key] === undefined) return undefined
  if (typeof params[key] !== 'boolean') fail(`${method}.${key} 需要布尔值`, { method, key })
  return params[key]
}

function optEnum(params, key, method, values) {
  if (params[key] === undefined) return undefined
  if (!values.includes(params[key])) fail(`${method}.${key} 只接受 ${values.join('/')}`, { method, key })
  return params[key]
}

/** 解析 pid:<n>。 */
export function parseAppHandle(value, method = 'appHandle') {
  if (typeof value !== 'string' || !value.startsWith(APP_HANDLE_PREFIX)) {
    throw new PtcError('APP_ACCESS_REQUIRED', `${method} 需要 appHandle（pid:<pid>）；请先 getApp(selector)`, { appHandle: value })
  }
  const pid = Number(value.slice(APP_HANDLE_PREFIX.length))
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new PtcError('APP_ACCESS_REQUIRED', `${method} 的 appHandle 不是有效的 pid:<pid>`, { appHandle: value })
  }
  return pid
}

export function makeAppHandle(pid) {
  const n = Number(pid)
  if (!Number.isInteger(n) || n <= 0) throw new PtcError('APP_NOT_FOUND', '无法为无效 pid 生成 appHandle', { pid })
  return `${APP_HANDLE_PREFIX}${n}`
}

/**
 * 元素 ID：<snapshotId>:<index>。snapshotId 用最后一个冒号切分，
 * 允许驱动未来的 snapshot id 带冒号。
 */
export function parseElementId(value, method = 'elementId') {
  if (typeof value !== 'string' || !value.includes(':')) {
    throw new PtcError('INVALID_ARGUMENT', `${method}.elementId 必须是 "<snapshotId>:<index>"`, { elementId: value })
  }
  const at = value.lastIndexOf(':')
  const snapshotId = value.slice(0, at)
  const index = Number(value.slice(at + 1))
  if (!snapshotId || !Number.isInteger(index) || index < 0) {
    throw new PtcError('INVALID_ARGUMENT', `${method}.elementId 格式无效`, { elementId: value })
  }
  return { snapshotId, index }
}

export function makeElementId(snapshotId, index) {
  if (typeof snapshotId !== 'string' || !snapshotId) {
    throw new PtcError('STALE_SNAPSHOT', '当前没有可用的快照 id；请先 getAccessibilityTree()', { snapshotId })
  }
  return `${snapshotId}:${Number(index)}`
}

function requireSnapshotMatch(params, method) {
  if (params.snapshotId === undefined || params.elementId === undefined) return
  const parsed = parseElementId(params.elementId, method)
  if (parsed.snapshotId !== String(params.snapshotId)) {
    throw new PtcError('STALE_SNAPSHOT', `${method} 的 elementId 不属于 snapshotId=${params.snapshotId}`, {
      method, snapshotId: params.snapshotId, elementId: params.elementId,
    })
  }
}

function checkTarget(params, method, { requireElement = false } = {}) {
  const hasElement = params.elementId !== undefined
  const hasPoint = params.x !== undefined || params.y !== undefined
  if (hasElement && hasPoint) fail(`${method} 不能同时给 elementId 与 x/y`, { method })
  if (requireElement && !hasElement) fail(`${method} 需要 elementId`, { method })
  if (!hasElement && (params.x === undefined || params.y === undefined)) {
    fail(`${method} 需要 elementId 或同时给 x/y`, { method })
  }
  if (hasElement) {
    parseElementId(params.elementId, method)
    if (params.snapshotId === undefined) fail(`${method} 使用 elementId 时必须同时给 snapshotId`, { method })
    requireSnapshotMatch(params, method)
  }
}

/** 方法级参数白名单与校验。返回不受支持的方法名（由 tool 层给诊断）。 */
export function validateRequest(method, params = {}) {
  if (typeof method !== 'string' || !METHOD_NAMES.includes(method)) {
    throw new PtcError('CAPABILITY_UNAVAILABLE', `未知方法 "${String(method)}"`, {
      method, available: CORE_METHODS,
    })
  }
  if (!isPlainObject(params)) fail(`${method}.params 需要对象`, { method })

  switch (method) {
    case 'getCapabilities':
    case 'listApps':
      checkKeys(params, [], method)
      break
    case 'findApps':
      checkKeys(params, ['query'], method)
      reqString(params, 'query', method)
      break
    case 'getApp':
      checkKeys(params, ['selector'], method)
      reqString(params, 'selector', method)
      break
    case 'listWindows':
      checkKeys(params, ['appHandle'], method)
      parseAppHandle(params.appHandle, method)
      break
    case 'getState':
      checkKeys(params, ['appHandle', 'windowId', 'maxElements', 'maxDepth', 'includeMenus', 'details'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      optInt(params, 'maxElements', method, { min: 1, max: 10000 })
      optInt(params, 'maxDepth', method, { min: 1, max: 100 })
      optBool(params, 'includeMenus', method)
      optBool(params, 'details', method)
      break
    case 'activate':
      checkKeys(params, ['appHandle', 'windowId'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      break
    case 'listActions':
      checkKeys(params, ['appHandle', 'windowId', 'snapshotId', 'elementId'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      reqString(params, 'snapshotId', method)
      reqString(params, 'elementId', method)
      requireSnapshotMatch(params, method)
      break
    case 'invoke':
      checkKeys(params, ['appHandle', 'windowId', 'snapshotId', 'elementId'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      reqString(params, 'snapshotId', method)
      reqString(params, 'elementId', method)
      requireSnapshotMatch(params, method)
      break
    case 'setValue':
      checkKeys(params, ['appHandle', 'windowId', 'snapshotId', 'elementId', 'value'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      reqString(params, 'snapshotId', method)
      reqString(params, 'elementId', method)
      requireSnapshotMatch(params, method)
      if (!['string', 'number', 'boolean'].includes(typeof params.value)) {
        fail('setValue.value 只接受字符串/数字/布尔值', { method })
      }
      break
    case 'typeText':
      checkKeys(params, ['appHandle', 'windowId', 'text'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      if (typeof params.text !== 'string') fail('typeText.text 需要字符串', { method })
      break
    case 'pressKey':
      checkKeys(params, ['appHandle', 'windowId', 'key', 'modifiers'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      reqString(params, 'key', method)
      if (params.modifiers !== undefined) {
        if (!Array.isArray(params.modifiers) || params.modifiers.some((m) => typeof m !== 'string')) {
          fail('pressKey.modifiers 需要字符串数组', { method })
        }
      }
      break
    case 'mouseMove':
      checkKeys(params, ['appHandle', 'windowId', 'snapshotId', 'elementId', 'x', 'y', 'relative', 'useSystemPointer'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      optString(params, 'snapshotId', method)
      optString(params, 'elementId', method)
      optNumber(params, 'x', method)
      optNumber(params, 'y', method)
      optBool(params, 'relative', method)
      optBool(params, 'useSystemPointer', method)
      checkTarget(params, method)
      break
    case 'click':
      checkKeys(params, ['appHandle', 'windowId', 'snapshotId', 'elementId', 'x', 'y',
        'mouseButton', 'clickCount', 'modifiers', 'holdMs', 'relative'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      optString(params, 'snapshotId', method)
      optString(params, 'elementId', method)
      optNumber(params, 'x', method)
      optNumber(params, 'y', method)
      optEnum(params, 'mouseButton', method, ['left', 'right', 'middle'])
      optInt(params, 'clickCount', method, { min: 1, max: 2 })
      optInt(params, 'holdMs', method, { min: 0, max: 2 ** 31 - 1 })
      optBool(params, 'relative', method)
      if (params.modifiers !== undefined) {
        if (!Array.isArray(params.modifiers) || params.modifiers.some((m) => typeof m !== 'string')) {
          fail('click.modifiers 需要字符串数组', { method })
        }
      }
      checkTarget(params, method)
      break
    case 'drag':
      checkKeys(params, ['appHandle', 'windowId', 'snapshotId', 'fromX', 'fromY', 'toX', 'toY',
        'mouseButton', 'modifiers', 'relative'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      optString(params, 'snapshotId', method)
      for (const k of ['fromX', 'fromY', 'toX', 'toY']) optNumber(params, k, method)
      optEnum(params, 'mouseButton', method, ['left', 'right', 'middle'])
      optBool(params, 'relative', method)
      if (params.modifiers !== undefined) {
        if (!Array.isArray(params.modifiers) || params.modifiers.some((m) => typeof m !== 'string')) {
          fail('drag.modifiers 需要字符串数组', { method })
        }
      }
      if (['fromX', 'fromY', 'toX', 'toY'].some((k) => params[k] === undefined)) {
        fail('drag 需要 fromX/fromY/toX/toY', { method })
      }
      break
    case 'screenshot':
      checkKeys(params, ['appHandle', 'windowId'], method)
      parseAppHandle(params.appHandle, method)
      reqInt(params, 'windowId', method)
      break
    case 'show':
      checkKeys(params, ['appHandle', 'windowId'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      break
    case 'scroll':
      checkKeys(params, ['appHandle', 'windowId', 'snapshotId', 'x', 'y',
        'deltaLinesX', 'deltaLinesY', 'relative'], method)
      parseAppHandle(params.appHandle, method)
      reqInt(params, 'windowId', method)
      optString(params, 'snapshotId', method)
      if (params.x === undefined || params.y === undefined) {
        fail('scroll 需要 x/y 坐标', { method })
      }
      optNumber(params, 'x', method)
      optNumber(params, 'y', method)
      optBool(params, 'relative', method)
      if (params.deltaLinesX === undefined && params.deltaLinesY === undefined) {
        fail('scroll 需要 deltaLinesX 或 deltaLinesY', { method })
      }
      for (const k of ['deltaLinesX', 'deltaLinesY']) {
        if (params[k] !== undefined && (!Number.isInteger(params[k]) || params[k] < -10 || params[k] > 10)) {
          fail(`scroll.${k} 需要 -10..10 的整数`, { method, key: k })
        }
      }
      break
    case 'selectText':
      checkKeys(params, ['appHandle', 'windowId', 'snapshotId', 'elementId', 'text',
        'prefix', 'suffix', 'selectionType'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      reqString(params, 'snapshotId', method)
      reqString(params, 'elementId', method)
      requireSnapshotMatch(params, method)
      reqString(params, 'text', method)
      optString(params, 'prefix', method)
      optString(params, 'suffix', method)
      optEnum(params, 'selectionType', method, ['text', 'cursor_before', 'cursor_after'])
      break
    case 'performAction':
      checkKeys(params, ['appHandle', 'windowId', 'snapshotId', 'elementId', 'action', 'argument'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      reqString(params, 'snapshotId', method)
      reqString(params, 'elementId', method)
      requireSnapshotMatch(params, method)
      reqString(params, 'action', method)
      break
    case 'paste':
      checkKeys(params, ['appHandle', 'windowId', 'text', 'format'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      if (typeof params.text !== 'string') fail('paste.text 需要字符串', { method })
      optEnum(params, 'format', method, ['text', 'html'])
      break
    case 'sendKeyEvent':
      checkKeys(params, ['appHandle', 'windowId', 'key', 'direction'], method)
      parseAppHandle(params.appHandle, method)
      optInt(params, 'windowId', method)
      reqString(params, 'key', method)
      optEnum(params, 'direction', method, ['down', 'up'])
      break
    default:
      break
  }
  return method
}

/** 生成 CAPABILITY_UNAVAILABLE。 */
export function capabilityUnavailable(method, extra = undefined) {
  const support = METHOD_SUPPORT[method] || { status: 'diagnostic', reason: '本轮没有实现', alternatives: [] }
  const details = {
    method,
    status: support.status,
    reason: support.reason || '本轮没有实现',
    alternatives: support.alternatives || [],
    ...(support.status === 'probe'
      ? { probe: 'evals/probe-uia-patterns.mjs', probeMethod: '只读 UIA pattern 探针，不注入输入' }
      : {}),
    ...(extra && typeof extra === 'object' ? extra : {}),
  }
  const alt = details.alternatives.length ? `；替代：${details.alternatives.join(' / ')}` : ''
  return new PtcError('CAPABILITY_UNAVAILABLE', `${method} 当前不可用：${details.reason}${alt}`, details)
}

export function optionUnavailable(method, option, reason, alternatives = []) {
  return new PtcError('CAPABILITY_OPTION_UNAVAILABLE',
    `${method}.${option} 当前不可用：${reason}${alternatives.length ? `；替代：${alternatives.join(' / ')}` : ''}`,
    { method, option, reason, alternatives })
}

/** 内层回执 → 稳定 PtcError。 */
export function receiptToPtcError(text) {
  const raw = String(text || '').trim()
  const body = raw.replace(/^✗\s*/, '')
  const details = { receipt: body.slice(0, 800) }
  if (/\[snapshot_missing\]/.test(body)) {
    return new PtcError('OBSERVE_REQUIRED', '需要先 getAccessibilityTree() 建立快照', details)
  }
  if (/\[snapshot_expired\]|\[snapshot_mismatch\]|\[index_out_of_range\]|\[snapshot_stale_tokens\]|\[snapshot_consumed\]|\[relative_coordinate_unavailable\]/.test(body)) {
    return new PtcError('STALE_SNAPSHOT', '快照已过期或被新观察替换；请重新 getAccessibilityTree()', details)
  }
  if (/\[relative_coordinate_invalid\]|\[relative_from_zoom_conflict\]/.test(body)) {
    return new PtcError('INVALID_ARGUMENT', 'relative 坐标无效或与 from_zoom 冲突', details)
  }
  if (/\[pointer_capture_missing\]|\[screenshot_unavailable\]|screenshot_context_missing|no_screenshot/.test(body)) {
    return new PtcError('SCREENSHOT_REQUIRED', '需要同一窗口的新截图上下文；请先 screenshot() 或 getAccessibilityTree()', details)
  }
  if (/\[model_image_unsupported\]/.test(body)) {
    return new PtcError('IMAGE_UNSUPPORTED', '当前模型路由未声明 image 输入', details)
  }
  if (/\[attachments_unavailable\]/.test(body)) {
    return new PtcError('ATTACHMENTS_UNAVAILABLE', '当前组合未挂载 attachments 服务，截图无法持久化', details)
  }
  if (/\[native_dialog_unsupported\]/.test(body)) {
    return new PtcError('CAPABILITY_UNAVAILABLE', '当前目标是原生 Win32 对话框，只支持有限的按钮点击', {
      ...details, status: 'diagnostic', method: 'native-dialog',
    })
  }
  if (/policy_|策略拒绝/.test(body)) {
    return new PtcError('POLICY_DENIED', 'autonomy 策略拒绝了该操作', details)
  }
  if (/停止|computer_stop|operation_locked/.test(body)) {
    return new PtcError('OPERATION_LOCKED', '电脑操作已被 computer_stop 锁存；先 computer_resume', details)
  }
  if (/未送达|delivery_failed|background_unavailable|foreground_unavailable|uipi/i.test(body)) {
    return new PtcError('DELIVERY_FAILED', '输入未送达目标；不要重复，先重新观察确认', details)
  }
  if (/超时|timeout/i.test(body)) {
    return new PtcError('OPERATION_TIMEOUT', '操作超时，结果未知；不要重复，先重新观察', details)
  }
  return new PtcError('OPERATION_FAILED', body || '操作失败', details)
}

/** 是否 core 方法。 */
export function isCoreMethod(method) {
  return METHOD_SUPPORT[method]?.status === 'core'
}
