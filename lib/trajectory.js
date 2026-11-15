/**
 * trajectory.js —— Computer Use 轨迹监控器（默认关闭）。
 *
 * 目标：把“模型在反复定位/反复点击”从主观观察变成可分析的 JSONL 轨迹。
 * CU 简化：
 * - 不落原文：type/set_value/clipboard/task 的文本只记长度 + 短哈希；
 * - 驱动调用只记关键参数和结果摘要，不落完整 AX 树/截图；
 * - 每个工具调用绑定一个 id；驱动调用通过 AsyncLocalStorage 归属到工具；
 * - 只做本地追加写，关闭时零开销（state=null）。
 *
 * 启用：config.trajectoryFile 或环境变量 DSH_CU_TRAJECTORY_FILE 指向 .jsonl。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()
let state = null
let exitHooked = false

const shortHash = (v) => createHash('sha1').update(String(v ?? '')).digest('hex').slice(0, 12)
const trunc = (v, n = 80) => {
  const s = String(v ?? '')
  return s.length > n ? s.slice(0, n) + '…' : s
}
const textShape = (v) => ({ len: String(v ?? '').length, hash: shortHash(v) })
const isTextKey = (k) => ['text', 'value', 'goal', 'success_criteria', 'constraints', 'prompt'].includes(k)

/** 工具参数白名单化：文本类只留长度/哈希；其余截断，避免轨迹泄露文档内容。 */
export function sanitizeArgs(name, args) {
  const walk = (obj, depth = 0) => {
    if (obj == null || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.slice(0, 16).map((v) => walk(v, depth + 1))
    if (depth > 2) return { keys: Object.keys(obj).slice(0, 8) }
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'session') continue
      if (isTextKey(k)) { out[k] = textShape(v); continue }
      if (k === 'element_token' || k === 'snapshot_id') { out[k] = trunc(v, 40); continue }
      if (k === 'path' && Array.isArray(v)) { out[k] = v.slice(0, 8).map((x) => trunc(x, 40)); continue }
      if (typeof v === 'string') { out[k] = trunc(v, k === 'query' || k === 'window' ? 60 : 100); continue }
      if (v && typeof v === 'object') { out[k] = walk(v, depth + 1); continue }
      out[k] = v
    }
    return out
  }
  void name
  return walk(args || {})
}

function errorFlags(text) {
  const s = String(text || '')
  return {
    snapshotMismatch: /snapshot_mismatch|snapshot_expired/.test(s),
    deliveryFailure: /delivery_failed|background_unavailable|foreground_unavailable|未送达/.test(s),
    refusal: /被引擎拒绝|refused|refusal|stale_element_token|menu_path_unavailable|suspected_noop/.test(s),
    staleElement: /stale_element_token/.test(s),
  }
}

function resultSummary(name, v) {
  const ok = Boolean(v && v.ok === true)
  const text = String(v?.result || '')
  const flags = errorFlags(text)
  const out = { ok }
  if (v && typeof v === 'object') {
    for (const k of ['snapshotId', 'coordinateSpace', 'mode', 'elementCount', 'visualOnly', 'crop', 'screenOrigin']) {
      if (v[k] !== undefined && k !== 'screenOrigin') out[k] = v[k]
    }
    if (v.window) out.window = {
      pid: v.window.pid, windowId: v.window.windowId,
      app: trunc(v.window.app, 40), title: trunc(v.window.title, 60),
    }
    if (v.image) out.image = { mediaType: v.image.mediaType, bytes: v.image.bytes, width: v.image.width, height: v.image.height }
    if (v.apps) out.appCount = Array.isArray(v.apps) ? v.apps.length : null
    if (v.results) out.resultCount = Array.isArray(v.results) ? v.results.length : null
  }
  // 失败/拒绝保留更多原文用于归因；成功只留短摘要。
  out.resultHead = trunc(text, ok && !flags.refusal && !flags.deliveryFailure ? 100 : 260)
  out.resultLen = text.length
  if (flags.snapshotMismatch) out.snapshotMismatch = true
  if (flags.deliveryFailure) out.deliveryFailure = true
  if (flags.refusal) out.refusal = true
  if (flags.staleElement) out.staleElement = true
  return out
}

function driverArgs(tool, args = {}) {
  const out = {}
  for (const [k, v] of Object.entries(args || {})) {
    if (k === 'session') continue
    if (k === 'text' || k === 'value') { out[k] = textShape(v); continue }
    if (k === 'element_token') { out[k] = shortHash(v); continue }
    if (k === 'query') { out[k] = trunc(v, 60); continue }
    if (k === 'path') { out[k] = Array.isArray(v) ? v.slice(0, 8).map((x) => trunc(x, 40)) : trunc(v, 80); continue }
    if (k === 'target' && v && typeof v === 'object') {
      out[k] = { kind: v.kind, pid: v.pid, window_id: v.window_id, display_id: v.display_id }
      continue
    }
    if (['pid', 'window_id', 'x', 'y', 'count', 'button', 'keys', 'key', 'delivery_mode', 'max_elements', 'x1', 'y1', 'x2', 'y2', 'scope'].includes(k)) {
      out[k] = Array.isArray(v) ? v.slice(0, 6) : v
    }
  }
  void tool
  return out
}

function driverValue(tool, value) {
  if (value == null) return {}
  if (typeof value !== 'object') return { text: trunc(value, 160) }
  if (tool === 'get_window_state') {
    return {
      elementCount: Array.isArray(value.elements) ? value.elements.length : null,
      snapshotId: value.snapshot_id ?? null,
      degraded: value.degraded_reason ?? null,
      screenshot: Boolean(value.screenshot_png_b64),
    }
  }
  if (tool === 'list_windows') {
    return {
      windowCount: Array.isArray(value.windows) ? value.windows.length : null,
      windows: Array.isArray(value.windows) ? value.windows.slice(0, 8).map((w) => ({
        pid: w.pid, windowId: w.window_id, app: trunc(w.app_name, 24),
        title: trunc(w.title, 48), z: w.z_index, onScreen: w.is_on_screen,
      })) : [],
    }
  }
  if (tool === 'check_permissions') return { elevated: value.elevated, uia: value.uia, postmessage: value.postmessage }
  if (tool === 'zoom') return { width: value.width, height: value.height, mime: value.mime_type }
  const out = {}
  for (const k of ['effect', 'delivery', 'route', 'code', 'reason', 'ok', 'status']) {
    if (value[k] !== undefined) out[k] = typeof value[k] === 'object' ? JSON.parse(JSON.stringify(value[k])) : value[k]
  }
  if (!Object.keys(out).length) out.keys = Object.keys(value).slice(0, 8)
  return out
}

function emit(type, data) {
  if (!state) return
  const ev = { t: new Date().toISOString(), ms: Date.now() - state.startedAt, seq: ++state.seq, type, ...data }
  try { appendFileSync(state.file, JSON.stringify(ev) + '\n') } catch { state.writeErrors++ }
}

function warn(kind, data) {
  if (!state) return
  const key = kind + ':' + (data.signature || data.tool || '')
  if (state.warned.has(key)) return
  state.warned.add(key)
  state.loops.push({ kind, ...data })
  emit('loop', { kind, ...data })
}

function account(name, args, summary, dur) {
  if (!state || name === 'computer_do') return
  state.toolCounts[name] = (state.toolCounts[name] || 0) + 1
  if (summary.deliveryFailure) state.deliveryFailures++
  if (summary.snapshotMismatch) state.staleSnapshots++
  if (summary.refusal) state.refusals++
  if (!summary.ok) state.errors++
  if (dur > state.slowestMs) state.slowestMs = dur

  const observation = name === 'screen_observe' || name === 'screen_zoom'
  if (observation) {
    state.observes++
    state.consecutiveObserves++
    if (state.consecutiveObserves >= 3) {
      warn('observe_burst', { count: state.consecutiveObserves, tool: name })
    }
  } else {
    state.actions++
    state.consecutiveObserves = 0
  }

  const sig = signatureFor(name, args)
  const now = Date.now()
  state.recent.push({ at: now, sig, name })
  state.recent = state.recent.filter((x) => now - x.at <= 60000).slice(-80)
  const same = state.recent.filter((x) => x.sig === sig).length
  state.repeatCounts.set(sig, same)
  if (same >= 3) {
    const bare = name.replace(/^computer_/, '')
    const kind = /^(click|double_click|right_click|type|key|scroll|drag|set_value)/.test(bare) ? 'repeat_action' : 'repeat_observe'
    warn(kind, { signature: sig, tool: name, count: same, windowSec: 60 })
  }
  if (state.actions >= 5 && state.observes / state.actions >= 2.5) {
    warn('relocate_ratio', { observes: state.observes, actions: state.actions, ratio: +(state.observes / state.actions).toFixed(2) })
  }
}

function signatureFor(name, args = {}) {
  if (name === 'screen_observe') return `obs:${args.window || args.window_id || '-'}:${args.mode || 'ax'}:${trunc(args.query, 30)}`
  if (name === 'screen_zoom') return `zoom:${args.window_id}:${args.x1},${args.y1},${args.x2},${args.y2}`
  const target = args.element !== undefined && args.element !== null
    ? String(args.element)
    : (args.x !== undefined || args.y !== undefined ? `${args.x},${args.y}` : '')
  const extra = args.key || args.direction || args.tool || (args.text ? `text:${shortHash(args.text)}` : '')
  return `act:${name}:${target || extra}`
}

/** 开始/切换轨迹文件；file 为空则关闭（state=null）。 */
export function trajectoryStart({ file, meta = {} } = {}) {
  const target = String(file || process.env.DSH_CU_TRAJECTORY_FILE || '').trim()
  if (!target) { state = null; return null }
  try { mkdirSync(dirname(target), { recursive: true }) } catch { /* 写失败时 append 会记录 */ }
  state = {
    file: target, startedAt: Date.now(), seq: 0, toolSeq: 0,
    toolCounts: {}, drivers: {}, observes: 0, actions: 0,
    consecutiveObserves: 0, errors: 0, refusals: 0, deliveryFailures: 0, staleSnapshots: 0,
    moveCount: 0, moveDistance: 0, moveTimes: [], lastMove: null,
    recent: [], repeatCounts: new Map(), warned: new Set(), loops: [],
    slowestMs: 0, writeErrors: 0,
  }
  emit('session_start', { meta })
  if (!exitHooked) {
    exitHooked = true
    process.once('exit', () => {
      try { if (state) emit('session_end', trajectorySummary()) } catch { /* 忽略退出期写失败 */ }
    })
  }
  return target
}

export function trajectoryActive() { return Boolean(state) }

/** 在工具上下文里执行；驱动调用通过 ALS 自动归属到当前工具。 */
export async function runTool(name, args, fn) {
  if (!state) return fn()
  const id = `t${++state.toolSeq}`
  const started = Date.now()
  emit('tool_start', { id, name, args: sanitizeArgs(name, args) })
  try {
    const v = await als.run({ id, name }, fn)
    const summary = resultSummary(name, v)
    const dur = Date.now() - started
    emit('tool_end', { id, name, dur, ...summary })
    account(name, args || {}, summary, dur)
    return v
  } catch (err) {
    const summary = { ok: false, error: trunc(err?.message || err, 260) }
    emit('tool_end', { id, name, dur: Date.now() - started, ...summary })
    account(name, args || {}, summary, Date.now() - started)
    throw err
  }
}

/** 驱动调用日志（cua.js rawCall 调用）。 */
export function logDriverCall(tool, args, dur, value, error) {
  if (!state) return
  const parent = als.getStore()?.id || null
  const summary = error ? { ok: false, error: trunc(error, 300) } : { ok: true, ...driverValue(tool, value) }
  emit('driver', { parent, tool, dur, args: driverArgs(tool, args), ...summary })
  state.drivers[tool] = (state.drivers[tool] || 0) + 1
  if (tool === 'move_cursor' && !error) {
    const x = Number(args?.x)
    const y = Number(args?.y)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const prev = state.lastMove
      if (prev) state.moveDistance += Math.hypot(x - prev.x, y - prev.y)
      state.lastMove = { x, y }
      state.moveCount++
      const now = Date.now()
      state.moveTimes.push(now)
      state.moveTimes = state.moveTimes.filter((t) => now - t <= 3000)
      if (state.moveTimes.length >= 20) warn('pointer_burst', { count: state.moveTimes.length, windowSec: 3 })
    }
  }
}

/** 当前轨迹摘要（写入 session_end / 测试）。 */
export function trajectorySummary() {
  if (!state) return null
  const repeats = [...state.repeatCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  return {
    file: state.file,
    startedAt: new Date(state.startedAt).toISOString(),
    durationMs: Date.now() - state.startedAt,
    tools: state.toolSeq,
    drivers: Object.values(state.drivers).reduce((a, b) => a + b, 0),
    driverTools: { ...state.drivers },
    observes: state.observes,
    actions: state.actions,
    observeActionRatio: state.actions ? +(state.observes / state.actions).toFixed(2) : null,
    errors: state.errors,
    refusals: state.refusals,
    deliveryFailures: state.deliveryFailures,
    staleSnapshots: state.staleSnapshots,
    moveCount: state.moveCount,
    moveDistancePx: Math.round(state.moveDistance),
    slowestMs: state.slowestMs,
    loops: state.loops.slice(-20),
    topRepeats: repeats.map(([signature, count]) => ({ signature, count })),
    writeErrors: state.writeErrors,
  }
}

/** 停止并落一条 session_end；测试/退出用。 */
export function trajectoryStop() {
  if (!state) return null
  const s = trajectorySummary()
  emit('session_end', s)
  state = null
  return s
}
