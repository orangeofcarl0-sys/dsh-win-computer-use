/**
 * computer_task 契约测试（dsh 0.2.2 基线）——受控假 subagents 服务。
 *
 * 0.2.2 只有 `ctx.subagents.startActivation(spec)`，没有 `start()` / `toolFilter`。
 * 覆盖：
 *   T1 请求构造：provider / label / delivery / prompt / outputSchema / maxDepth / agentOptions；
 *      request 不含 toolFilter/label/signal；结果映射 + 同级能力说明 + dispose
 *   T2 紧凑回执（≤400 字符）+ 复核建议
 *   T3 未返回结构化结果 → 失败并附子 agent 末尾输出
 *   T4 每会话预算：前 3 次放行、第 4 次拒绝并指内联
 *   T5 宿主无 subagents 服务 → 返回委派配方
 *   T6 outputSchema 被拒 → 去掉后重试，如实标注未结构化
 *   T7 所有启动尝试失败 → 明确报错
 *   T8 只有 list、没有 startActivation → 委派配方
 *   T9 长任务不会在返回前提前 dispose
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, loadPlugin, makeServices, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('task')
const { check, state: checkState } = makeChecks()

const plugin = await loadPlugin(work)
const mod = await import(pathToFileURL(join(work, 'index.js')).href)
const { DELEGATION_RECIPE, resetTaskCalls } = await import(pathToFileURL(join(work, 'lib', 'task.js')).href)

async function setup({ subagents } = {}) {
  const overrides = subagents ? { subagents } : {}
  const { reg, ctx, exec } = makeCtx({ services: makeServices(overrides), agent: { id: 'parent-agent' } })
  plugin.apply(ctx, { ttlMs: 60000, maxElements: 120, deliveryMode: 'auto', passwordScan: 'off' })
  const defs = new Map(mod.toolDefinitions().map((d) => [d.name, d]))
  resetTaskCalls()
  return {
    call: (name, args) => (defs.get(name) || reg.get(name)).execute(args, exec),
    reg,
    defs,
  }
}

const activation = (result, onDispose) => ({
  childId: 'child-1',
  messageId: 'msg-1',
  result: Promise.resolve(result),
  async dispose() { onDispose?.() },
})

// ── T1/T2：请求构造 + 结构化结果映射 ─────────────────────────────────
{
  let seen = null
  let disposed = false
  const fake = {
    getProvider: (name) => (name === 'spawn' ? {} : undefined),
    async startActivation(spec) {
      seen = spec
      return activation({
        stopReason: 'completed',
        structured: { ok: true, summary: '已把两行文字保存到 note.txt', evidence: ['文件存在且内容匹配'] },
      }, () => { disposed = true })
    },
  }
  const { call } = await setup({ subagents: fake })
  const r = await call('computer_task', {
    goal: '把两行文字保存到 C:\\tmp\\note.txt',
    success_criteria: '文件内容逐字匹配',
    timeout_min: 3,
    model: 'test-model',
    model_effort: 'high',
  })
  const spec = seen || {}
  const prompt = spec.prompt?.[0]?.text || ''
  check('T1 走 startActivation（provider/label/delivery）',
    seen?.provider === 'spawn' && /computer_task/.test(seen?.label || '') && seen?.delivery === 'caller')
  check('T1 prompt 含目标/判据/收尾 JSON 契约',
    prompt.includes('C:\\tmp\\note.txt') && prompt.includes('逐字匹配') && /"ok": boolean/.test(prompt) && /禁止使用命令行/.test(prompt))
  check('T1 spec 扁平且不含 request/toolFilter',
    !('request' in spec) && !('toolFilter' in spec) && !!spec.prompt && !!spec.parent,
    Object.keys(spec).join(','))
  check('T1 outputSchema 必填 ok/summary',
    JSON.stringify(spec.outputSchema?.required) === JSON.stringify(['ok', 'summary']))
  check('T1 maxDepth=1 且 parent/signal 已传',
    spec.maxDepth === 1 && !!spec.parent && !!spec.signal)
  check('T1 agentOptions 透传 model/effort',
    spec.agentOptions?.model === 'test-model' && spec.agentOptions?.reasoningEffort === 'high')
  check('T1 结果映射 + 同级能力说明',
    r.ok === true && r.structured?.summary === '已把两行文字保存到 note.txt' && /同级的能力/.test(r.result))
  check('T1 activation 被 dispose', disposed === true)
  check('T2 紧凑回执（≤400 字符）+ 复核建议',
    r.result.length <= 400 && /廉价复核/.test(r.result), `${r.result.length} 字符`)
}

// ── T3：无结构化结果 ────────────────────────────────────────────────
{
  const fake = {
    list: () => ['spawn'],
    async startActivation() {
      return activation({ stopReason: 'error', output: [{ type: 'text', text: '我尽力了但没成功' }] })
    },
  }
  const { call } = await setup({ subagents: fake })
  const r = await call('computer_task', { goal: 'x' })
  check('T3 无结构化 → ok=false 且附末尾输出',
    r.ok === false && /未返回结构化结果/.test(r.result) && /尽力了/.test(r.result), r.result.slice(0, 80))
}

// ── T4：委派预算 ───────────────────────────────────────────────────
{
  const fake = {
    list: () => ['spawn'],
    async startActivation() {
      return activation({ stopReason: 'completed', structured: { ok: true, summary: 'ok' } })
    },
  }
  const { call } = await setup({ subagents: fake })
  const r1 = await call('computer_task', { goal: 'a' })
  const r2 = await call('computer_task', { goal: 'b' })
  const r3 = await call('computer_task', { goal: 'c' })
  const r4 = await call('computer_task', { goal: 'd' })
  check('T4 预算 3 次：前 3 次放行、第 4 次拒绝并指内联',
    r1.ok && r2.ok && r3.ok && r4.ok === false && /已达上限/.test(r4.result) && /内联/.test(r4.result),
    String(r4.result).slice(0, 70))
}

// ── T5：宿主缺失服务 → 配方 ─────────────────────────────────────────
{
  const { call } = await setup({ subagents: null })
  const r = await call('computer_task', { goal: '任意' })
  check('T5 无服务 → 返回配方且未执行',
    r.ok === false && r.result.includes(DELEGATION_RECIPE.slice(0, 20)) && /子任务/.test(r.result),
    r.result.slice(0, 70))
}

// ── T6：outputSchema 被拒 → 去掉后重试 ──────────────────────────────
{
  let calls = 0
  const fake = {
    list: () => ['spawn'],
    async startActivation(spec) {
      calls++
      if (spec.outputSchema) throw new Error('outputSchema not supported')
      return activation({ stopReason: 'completed', output: [{ type: 'text', text: '完成了' }] })
    },
  }
  const { call } = await setup({ subagents: fake })
  const r = await call('computer_task', { goal: '无结构化' })
  check('T6 outputSchema 被拒 → 第二次不带 outputSchema', calls === 2, `calls=${calls}`)
  check('T6 回执如实标注未结构化',
    r.ok === false && /未返回结构化结果/.test(r.result) && /结果未结构化/.test(r.result), r.result.slice(0, 100))
}

// ── T7：所有启动尝试失败 → 明确报错 ─────────────────────────────────
{
  const fake = {
    list: () => ['spawn'],
    async startActivation() { throw new Error('no provider capability') },
  }
  const { call } = await setup({ subagents: fake })
  const r = await call('computer_task', { goal: 'x' })
  check('T7 全部失败 → 启动失败（不静默）', r.ok === false && /启动失败/.test(r.result), r.result.slice(0, 80))
}

// ── T8：只有 list、没有 startActivation → 配方 ──────────────────────
{
  const fake = { list: () => ['spawn'] }
  const { call } = await setup({ subagents: fake })
  const r = await call('computer_task', { goal: 'x' })
  check('T8 无 startActivation → 返回委托配方', r.ok === false && /子任务/.test(r.result), r.result.slice(0, 80))
}

// ── T9：长任务不会在返回前提前 dispose ──────────────────────────────
{
  let disposed = false
  const fake = {
    list: () => ['spawn'],
    async startActivation() {
      return {
        childId: 'child-long',
        result: new Promise(() => {}),
        async dispose() { disposed = true },
      }
    },
  }
  const { call } = await setup({ subagents: fake })
  const p = call('computer_task', { goal: 'x', timeout_min: 1 })
  await new Promise((r) => setTimeout(r, 30))
  check('T9 长任务进行中未提前 dispose', disposed === false)
  void p // 1 分钟超时不在此等待；process.exit 会结束
}

console.log(`\n结果：${checkState.failures ? '❌ ' + checkState.failures + ' 项失败' : '✅ 全部通过'}`)
if (!checkState.failures) cleanupWork(work)
process.exit(checkState.failures ? 1 : 0)
