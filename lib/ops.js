/**
 * ops.js —— v0.5.0 新工具的驱动包装：确定性验证 / 谓词轮询 / 剪贴板 / 菜单 / 悬停 / 强杀锁存。
 *
 * 立场：验证是确定性谓词（driver verify_state），unknown 永不视为成功（fail-closed）；
 * computer_stop 是真杀开关（锁存），resume 是唯一解锁路径（PLAN-tools-v0.5 §6-D2=B）。
 */
import { cuaCall, withSession, CUA_SESSION, isUnverified } from './cua.js'
import { engineRefusal } from './engine.js'
import { clearSnapshot, clearInputUnconfirmed, getSnapshot } from './snapshot.js'
import { saveImageAttachment } from './attach.js'
import { refusalReceipt } from './receipt.js'

export function createOpsState() {
  return { stopped: false }
}

/** 锁存闸门：stopped 时除 computer_resume 外全部拒绝。返回拒绝文本或 null。 */
export function gate(state, toolName) {
  if (state.stopped && toolName !== 'computer_resume') {
    return '已停止（computer_stop 锁存中）：全部桌面操作（观察/动作/应用）已拒绝。用户明示继续后调用 computer_resume 解锁。'
  }
  return null
}

/** 强杀：结束驱动会话（光标/录制/清理）+ 清观察快照 + 落锁。 */
export async function stop(state) {
  const v = await cuaCall('end_session', { session: CUA_SESSION })
    .catch((e) => ({ error: String(e?.message || e) }))
  const refusal = engineRefusal(v)
  const note = refusal || (v && v.error)
    ? `（驱动会话结束未确认：${refusal || v.error}；锁存已生效）`
    : ''
  clearSnapshot()
  clearInputUnconfirmed()
  state.stopped = true
  return { ok: true, result: `已停止：观察快照清空、全部桌面操作锁存（观察/动作/应用一律拒绝）。${note}用户明示继续后调用 computer_resume 解锁。` }
}

/** 解锁：清锁存 + 预热会话（下个动作零延迟）。快照已清，首个动作前必须重新观察。 */
export async function resume(state) {
  const v = await cuaCall('start_session', { session: CUA_SESSION })
    .catch((e) => ({ error: String(e?.message || e) }))
  const refusal = engineRefusal(v)
  if (refusal || (v && v.error)) {
    // 会话没重建时保持锁存；resume 是唯一解锁路径，不能假装成功。
    return { ok: false, result: `解锁失败：驱动会话未重建（${refusal || v.error}）；锁存保持，请检查驱动后重试 computer_resume。` }
  }
  state.stopped = false
  clearSnapshot()
  clearInputUnconfirmed()
  return { ok: true, result: '已解锁：会话已重建。观察快照为空——先 screen_observe 取得新鲜快照再操作。' }
}

/** 解析 expect（JSON 字符串或数组）→ 谓词数组（1-8 条）。 */
export function parseExpect(expect) {
  let list = expect
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch (err) {
      throw new Error(`expect 不是合法 JSON：${err.message}`)
    }
  }
  if (!Array.isArray(list) || list.length === 0) throw new Error('expect 至少需要 1 条谓词。')
  if (list.length > 8) throw new Error('expect 最多 8 条谓词。')
  return list
}

function safeParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * 确定性验证一次：调 driver verify_state 并规范化。
 * @returns {{ok:boolean, status:string, stable:boolean, waitedMs?:number, results:{index:number,status:string,unknownReason:string|null,expect:string,observed:string|null}[]}}
 */
export async function verifyOnce(ctx, args) {
  const expect = parseExpect(args.expect)
  const payload = withSession({ pid: args.pid, window_id: args.window_id, expect })
  const wantShot = Boolean(args.include_screenshot)
  if (args.include_screenshot != null) payload.include_screenshot = wantShot
  const v = await cuaCall('verify_state', payload)
  const preds = Array.isArray(v?.predicates) ? v.predicates : []
  const results = preds.map(p => ({
    index: p.index,
    status: p.status,
    unknownReason: p.unknown_reason ?? null,
    expect: JSON.stringify(expect[p.index] ?? null),
    observed: typeof p.observed_json === 'string' ? p.observed_json : null,
  }))
  const allSatisfied = preds.length > 0 && preds.every(p => p.status === 'satisfied')
  const out = {
    ok: allSatisfied,
    status: v?.status ?? (allSatisfied ? 'satisfied' : 'unknown'),
    stable: Boolean(v?.stable),
    results,
  }
  if (wantShot && v?.screenshot_png_b64) {
    const attachments = ctx?.get?.('attachments')
    if (attachments) {
      try {
        out.image = await saveImageAttachment(attachments, {
          data: Buffer.from(v.screenshot_png_b64, 'base64'),
          mediaType: v.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
          name: `verify-${args.pid ?? 'x'}.png`,
        })
      } catch { /* 证据图不可存时不阻塞断言结果 */ }
    }
  }
  const brief = results.map(r => `#${r.index} ${r.status === 'satisfied' ? '满足' : r.status === 'unsatisfied' ? '不满足' : `unknown(${r.unknownReason ?? '?'})`}`).join('；')
  out.result = `验证 ${out.status}${out.stable ? '' : '（未稳定）'}：${brief}。${out.ok ? '' : '注意：unknown 表示无法观测/无法证明，不是失败也不是成功。'}`
  return out
}

/** 谓词轮询：verifyOnce 循环直到全部满足或超时。每次验证是一次完整 UIA 走查（秒级），pollMs 为轮询下限。 */
export async function waitFor(ctx, args, cfg) {
  const timeoutMs = Math.max(1000, Math.min(60000, Number(args.timeoutMs) || 10000))
  const pollMs = Math.max(250, Number(args.pollMs) || 1000)
  const started = Date.now()
  let last = null
  let attempts = 0
  for (;;) {
    attempts++
    last = await verifyOnce(ctx, args)
    if (last.ok) {
      return { ...last, ok: true, attempts, waitedMs: Date.now() - started, result: `${last.result}（第 ${attempts} 次验证满足，等待 ${Date.now() - started}ms）` }
    }
    if (Date.now() - started >= timeoutMs) {
      return { ...last, ok: false, attempts, waitedMs: Date.now() - started, result: `${last.result}（等待超时 ${Date.now() - started}ms，共 ${attempts} 次验证）` }
    }
    await new Promise(r => setTimeout(r, pollMs))
  }
}

/** 剪贴板读写。粘贴流：write + computer_key('ctrl+v') 是特殊字符/长文本最可靠的输入路径。 */
export async function clipboard(args) {
  if (args.action === 'write') {
    if (!args.text) throw new Error('write 需要 text 参数。')
    const v = await cuaCall('clipboard_write', withSession({ text: String(args.text) }))
    const refusal = engineRefusal(v)
    const unsupported = v && typeof v === 'object' && v.supported === false
      ? '剪贴板不可用（supported:false）'
      : ''
    const err = refusal || unsupported || (v && (v.error || v.error_code)) || ''
    if (err) {
      return { ok: false, result: `剪贴板写入失败：${String(err).slice(0, 200)}。粘贴流暂不可用；不要假设已写入。` }
    }
    return { ok: true, result: `已写入剪贴板（${String(args.text).length} 字符）。粘贴路径：computer_key('ctrl+v')。` }
  }
  const v = await cuaCall('clipboard_read', withSession({ include_text: true }))
  const refusal = engineRefusal(v)
  const unsupported = v && typeof v === 'object' && v.supported === false
    ? '剪贴板不可用（supported:false）'
    : ''
  const err = refusal || unsupported || (v && (v.error || v.error_code)) || ''
  if (err) {
    return { ok: false, result: `剪贴板读取失败：${String(err).slice(0, 200)}。` }
  }
  const text = v?.text ?? v?.plain_text ?? null
  return {
    ok: true,
    text,
    result: text == null || text === ''
      ? '剪贴板无文本内容。'
      : `剪贴板文本：\n${String(text).slice(0, 2000)}\n（隐私注记：以上为系统剪贴板内容，请按需使用后不要再转述。）`,
  }
}

/** 菜单路径不可用时，尽量给出当前快照里顶层菜单栏项的具体编号。 */
function menuOpenHint(path) {
  const first = String(path?.[0] || '')
  if (!first) return ''
  const snap = getSnapshot()
  if (!snap?.entries) return ''
  for (const [index, e] of snap.entries) {
    if (/menu|菜单/i.test(String(e.role || '')) && String(e.label || '') === first) {
      return `（当前快照里有菜单栏项“${first}”编号 [${index}]：先 computer_click(element=${index}) 打开菜单，再 screen_observe 取菜单项编号。）`
    }
  }
  return ''
}

/** 菜单路径直调（驱动 fail-closed：缺失/歧义/禁用/结构不匹配即失败，绝不回退像素）。 */
export async function menu(args) {
  let path = args.path
  if (typeof path === 'string') {
    try {
      path = JSON.parse(path)
    } catch (err) {
      // 模型常写 "文件/保存"；在不是 JSON 时接受 /、›、> 作为层级分隔。
      if (/[\/›>]/.test(path)) {
        path = path.split(/[\/›>]+/).map((s) => s.trim()).filter(Boolean)
      } else {
        throw new Error(`path 不是合法 JSON 或可解析的菜单路径：${err.message}（示例：["文件","保存"] 或 "文件/保存"）`)
      }
    }
  }
  if (!Array.isArray(path) || path.length === 0) throw new Error('path 至少需要 1 级菜单名。')
  const v = await cuaCall('invoke_menu', withSession({ pid: args.pid, window_id: args.window_id, path }))
  // 驱动的结构化拒绝（{"refusal":{...}}）此前被当成成功上报——菜单没打开却告诉模型"已调用"，
  // 模型会据此继续下一步（2026-09-16 Win11 记事本实测：menu_path_unavailable）。
  const refusal = engineRefusal(v)
  if (refusal) return refusalReceipt('菜单调用', refusal, menuOpenHint(path))
  // effect:unverifiable = 驱动只受理了调用，没有证明菜单真的打开（2026-11-14 t01 实测：
  // ["文件"] 回执“已调用”，但窗口状态未变，模型据此继续下一步 → 长链试错）。
  const effect = v && typeof v === 'object' ? v.effect : undefined
  // effect 缺失也不能当成功：驱动没给 confirmed 就没有证据。旧实现只在 effect
  // 存在且不是 confirmed 时失败，effect 缺失会落到“已调用”。
  if (isUnverified(v) || effect !== 'confirmed') {
    const raw = typeof v === 'string' ? v : JSON.stringify(v || {})
    return {
      ok: false,
      result: `菜单调用未确认：驱动没有证明菜单已打开（${raw.slice(0, 120)}）。不要重复调用同一路径；先 screen_observe 复核目标窗口。`
        + `若菜单未打开：改用 computer_click(element=<菜单栏项编号>) 点开菜单，再 screen_observe 取弹出菜单项编号后点击；`
        + `若菜单已打开：直接点菜单项。`,
    }
  }
  const detail = v && typeof v === 'object' ? `（驱动：${JSON.stringify(v).slice(0, 300)}）` : ''
  return { ok: true, result: `已调用菜单路径：${path.join(' › ')}${detail}` }
}

/**
 * 悬停（实验性）：默认 scope=window 移动 agent 虚拟光标到窗口本地截图像素 (x,y)——
 * 能否触发目标应用的真实 hover（工具提示/悬停菜单）取决于应用，未验证。
 * real=true 时 scope=desktop 移动真实 OS 指针，此时 x/y 为屏幕坐标（需自行从窗口坐标换算）。
 */
export async function hover(args) {
  const x = Number(args.x)
  const y = Number(args.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('hover 需要 x/y。')
  const payload = { x, y }
  if (args.real) {
    payload.scope = 'desktop'
  } else {
    payload.scope = 'window'
    if (args.pid != null && args.window_id != null) {
      payload.target = { kind: 'window', pid: args.pid, window_id: args.window_id }
    }
  }
  const v = await cuaCall('move_cursor', withSession(payload))
  const refusal = engineRefusal(v)
  if (refusal) return { ok: false, result: `悬停移动被引擎拒绝：${refusal}。` }
  const unverified = isUnverified(v) ? '（驱动未验证移动结果；请 observe 确认指针/悬停状态）' : ''
  return { ok: true, result: `虚拟光标已移至 (${x},${y})${args.real ? '（真实指针，屏幕坐标）' : '（窗口覆盖层）'}。实验性：hover 效果取决于目标应用。${unverified}` }
}
