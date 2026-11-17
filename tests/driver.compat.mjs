/**
 * driver.compat.mjs —— 端到端兼容测试（真实 observe/refresh + 注入 transport）。
 *
 * 不 spawn 真实驱动：工作副本里的 lib/cua.js 用 __setTransportForTests 注入 fake。
 * 目的：0.23.2 形态与 0.53 形态经过真实 screenObserve/refreshSnapshotState 后，
 * 窗口、元素编号、本地坐标、计数一致；0.53 的 window_title/window_bounds 能进入
 * 复核路径（旧代码在这里会静默丢标题/原点）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeWorkCopy, cleanupWork } from './lib/harness.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const load = (name) => JSON.parse(readFileSync(join(root, 'fixtures', 'driver', name), 'utf8'))
const legacyWindow = load('legacy.window.json')
const v053Window = load('v053.window.json')
const windowList = load('windows.json')

let failures = 0
const check = async (name, fn) => {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (err) {
    failures++
    console.log(`❌ ${name} — ${String(err.message).slice(0, 240)}`)
  }
}

const work = makeWorkCopy('compat')
const cua = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
const observe = await import(pathToFileURL(join(work, 'lib', 'observe.js')).href)
const snapshot = await import(pathToFileURL(join(work, 'lib', 'snapshot.js')).href)

function fakeTransport({ state, version = '0.53.0', calls = [] }) {
  let current = state
  return {
    bin: 'fake-cua',
    calls,
    async runOnce(argv) {
      if (argv[0] === '--version') return { code: 0, stdout: `cua-driver ${version}\n`, stderr: '' }
      if (argv[0] === 'status') return { code: 0, stdout: 'contract: 0.8.0\nSDK: 0.8.0', stderr: '' }
      return { code: 1, stdout: '', stderr: 'unknown' }
    },
    async rawCall(tool, args) {
      calls.push({ tool, args })
      if (tool === 'list_windows') return windowList
      if (tool === 'get_window_state') return typeof current === 'function' ? current(args) : current
      if (tool === 'check_permissions') {
        return { elevated: false, integrity_level: 'medium', uia: true, post_message: true }
      }
      if (tool === 'get_desktop_state') return { screenshot_width: 0, screenshot_height: 0 }
      return { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }
    },
  }
}

const cfg = {
  ttlMs: 60000,
  maxElements: 120,
  observeDedup: 'off',
  passwordScan: 'off',
  deliveryMode: 'auto',
  supersession: 'note',
  cursorMotion: 'auto',
  verifyAfterAction: 'off',
  nativeImage: 'auto',
}

async function runObserve(state, version) {
  const calls = []
  cua.__setTransportForTests(fakeTransport({ state, version, calls }))
  observe.dedupReset()
  snapshot.clearSnapshot()
  const r = await observe.screenObserve({}, { pid: 42, window_id: 7 }, cfg, {})
  const snap = snapshot.getSnapshot()
  return { r, snap, calls }
}

await check('K1 legacy 形态：observe 产出 3 个元素与快照坐标', async () => {
  const { r, snap, calls } = await runObserve(legacyWindow, '0.23.2')
  assert.equal(r.ok, true)
  assert.match(r.result, /S4 Shape/)
  assert.equal(snap.entries.size, 3)
  assert.equal(snap.entries.get(0).token, 'tok-0')
  assert.ok(calls.some((c) => c.tool === 'get_window_state' && c.args.tree_format === 'elements'))
  assert.ok(Number.isFinite(snap.entries.get(0).x))
})

await check('K2 v053 形态：observe 产出相同编号/token/标题', async () => {
  const { r, snap } = await runObserve(v053Window, '0.53.0')
  assert.equal(r.ok, true)
  assert.match(r.result, /S4 Shape/)
  assert.equal(snap.entries.size, 3)
  assert.equal(snap.entries.get(0).token, 'tok-0')
  assert.equal(snap.entries.get(0).role, 'Button')
})

await check('K3 legacy 与 v053 的本地坐标 ≤2px', async () => {
  const a = await runObserve(legacyWindow, '0.23.2')
  const b = await runObserve(v053Window, '0.53.0')
  for (let i = 0; i < 3; i++) {
    const ea = a.snap.entries.get(i)
    const eb = b.snap.entries.get(i)
    assert.ok(Math.abs(ea.x - eb.x) <= 2, `x[${i}] ${ea.x} vs ${eb.x}`)
    assert.ok(Math.abs(ea.y - eb.y) <= 2, `y[${i}] ${ea.y} vs ${eb.y}`)
  }
})

await check('K4 v053 复核：window_title 变化可见（旧代码会丢）', async () => {
  const calls = []
  cua.__setTransportForTests(fakeTransport({ state: v053Window, version: '0.53.0', calls }))
  observe.dedupReset()
  snapshot.clearSnapshot()
  await observe.screenObserve({}, { pid: 42, window_id: 7 }, cfg, {})
  const changed = { ...v053Window, window_title: 'S4 Shape *' }
  cua.__setTransportForTests(fakeTransport({ state: changed, version: '0.53.0', calls }))
  const res = await observe.refreshSnapshotState(cfg, 42, 7)
  assert.equal(res.ok, true)
  assert.equal(res.title, 'S4 Shape *')
})

await check('K5 v053 复核：window_bounds 进入新快照', async () => {
  const calls = []
  cua.__setTransportForTests(fakeTransport({ state: v053Window, version: '0.53.0', calls }))
  observe.dedupReset()
  snapshot.clearSnapshot()
  await observe.screenObserve({}, { pid: 42, window_id: 7 }, cfg, {})
  const moved = {
    ...v053Window,
    window_bounds: { x: 500, y: 400, width: 1058, height: 799 },
    elements: v053Window.elements.map((e) => ({ ...e })),
  }
  cua.__setTransportForTests(fakeTransport({ state: moved, version: '0.53.0', calls }))
  const res = await observe.refreshSnapshotState(cfg, 42, 7)
  const snap = snapshot.getSnapshot()
  assert.equal(res.ok, true)
  assert.equal(snap.screenOrigin.x, 500)
  assert.equal(snap.screenOrigin.y, 400)
})

await check('K6 tree_format 被拒时自动去掉并重试', async () => {
  const calls = []
  const transport = fakeTransport({ state: legacyWindow, version: '0.23.2', calls })
  transport.rawCall = async (tool, args) => {
    calls.push({ tool, args })
    if (tool === 'get_window_state' && args.tree_format !== undefined) {
      const err = new Error('invalid_arguments: unknown field tree_format')
      err.kind = 'exit'
      throw err
    }
    if (tool === 'list_windows') return windowList
    if (tool === 'check_permissions') return { elevated: false, uia: true, postmessage: true }
    if (tool === 'get_window_state') return legacyWindow
    return { ok: true }
  }
  cua.__setTransportForTests(transport)
  observe.dedupReset()
  snapshot.clearSnapshot()
  const r = await observe.screenObserve({}, { pid: 42, window_id: 7 }, cfg, {})
  assert.equal(r.ok, true)
  assert.ok(calls.filter((c) => c.tool === 'get_window_state').length >= 2)
})

cleanupWork(work)
console.log(`\n结果：${failures ? `❌ ${failures} 项失败` : '✅ 全部通过'}`)
process.exit(failures ? 1 : 0)
