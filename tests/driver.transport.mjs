/**
 * driver.transport.mjs —— 传输层离线测试（fake spawn，无真实驱动）。
 * 覆盖：成功 JSON、非零退出、非 JSON、ENOENT、timeout、contract mismatch、
 * session ended、固定 argv、runOnce。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createTransport, DriverCallError, contractMismatchOf, isSessionEndedText } from '../lib/driver/transport.js'

let failures = 0
const check = async (name, fn) => {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (err) {
    failures++
    console.log(`❌ ${name} — ${String(err.message).slice(0, 200)}`)
  }
}

function fakeChild({ out = '', err = '', code = 0, error = null, close = true } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => { child.killed = true }
  setImmediate(() => {
    if (error) { child.emit('error', error); return }
    if (out) child.stdout.emit('data', out)
    if (err) child.stderr.emit('data', err)
    if (close) child.emit('close', code)
  })
  return child
}

const noLog = () => undefined

const main = async () => {
  await check('T1 成功：解析 stdout JSON', async () => {
    const calls = []
    const t = createTransport({
      bin: 'fake-cua',
      spawnImpl: (bin, argv) => { calls.push({ bin, argv }); return fakeChild({ out: '{"ok":true}' }) },
      log: noLog,
    })
    const v = await t.rawCall('list_windows', { on_screen_only: true })
    assert.deepEqual(v, { ok: true })
    assert.equal(calls[0].bin, 'fake-cua')
    assert.deepEqual(calls[0].argv, ['call', 'list_windows', '{"on_screen_only":true}'])
  })

  await check('T2 非零退出 → kind=exit，消息含 stderr', async () => {
    const t = createTransport({
      spawnImpl: () => fakeChild({ code: 3, err: 'boom' }), log: noLog,
    })
    await assert.rejects(t.rawCall('click', {}), (e) => {
      assert.equal(e.kind, 'exit')
      assert.equal(e.exitCode, 3)
      assert.match(e.message, /boom/)
      return true
    })
  })

  await check('T2b 非零退出 + JSON → kind=structured，value 可供投递升级', async () => {
    const t = createTransport({
      spawnImpl: () => fakeChild({
        code: 1,
        out: '{"code":"background_unavailable","suggestion":"foreground"}',
      }),
      log: noLog,
    })
    await assert.rejects(t.rawCall('click', {}), (e) => {
      assert.equal(e.kind, 'structured')
      assert.equal(e.value.code, 'background_unavailable')
      return true
    })
  })

  await check('T3 非 JSON → kind=nonjson', async () => {
    const t = createTransport({
      spawnImpl: () => fakeChild({ out: 'not-json' }), log: noLog,
    })
    await assert.rejects(t.rawCall('click', {}), (e) => {
      assert.equal(e.kind, 'nonjson')
      assert.match(e.message, /返回非 JSON/)
      return true
    })
  })

  await check('T4 ENOENT → kind=spawn + 自救指引', async () => {
    const err = Object.assign(new Error('spawn cua-driver ENOENT'), { code: 'ENOENT' })
    const t = createTransport({ spawnImpl: () => fakeChild({ error: err }), log: noLog })
    await assert.rejects(t.rawCall('click', {}), (e) => {
      assert.equal(e.kind, 'spawn')
      assert.match(e.message, /CUA_DRIVER_BIN/)
      return true
    })
  })

  await check('T5 spawn 同步抛错 → kind=spawn', async () => {
    const t = createTransport({
      spawnImpl: () => { throw new Error('bad exec') }, log: noLog,
    })
    await assert.rejects(t.rawCall('click', {}), (e) => {
      assert.equal(e.kind, 'spawn')
      assert.match(e.message, /bad exec/)
      return true
    })
  })

  await check('T6 超时 → kind=timeout，并 kill 子进程', async () => {
    let child
    const t = createTransport({
      spawnImpl: () => { child = fakeChild({ close: false }); return child },
      timeoutMs: 30,
      log: noLog,
    })
    await assert.rejects(t.rawCall('click', {}), (e) => {
      assert.equal(e.kind, 'timeout')
      assert.match(e.message, /timeout after 30ms/)
      return true
    })
    assert.equal(child.killed, true)
  })

  await check('T6b per-call timeout 覆盖默认超时', async () => {
    let child
    const t = createTransport({
      spawnImpl: () => { child = fakeChild({ close: false }); return child },
      timeoutMs: 5000,
      log: noLog,
    })
    await assert.rejects(t.rawCall('move_cursor', {}, { timeoutMs: 20 }), (e) => {
      assert.equal(e.kind, 'timeout')
      assert.match(e.message, /timeout after 20ms/)
      return true
    })
    assert.equal(child.killed, true)
  })

  await check('T7 contract mismatch → kind=contract_mismatch + 同步升级指引', async () => {
    const t = createTransport({
      spawnImpl: () => fakeChild({
        code: 1,
        err: 'contract version 0.7.0 does not match SDK 0.8.0',
      }),
      log: noLog,
    })
    await assert.rejects(t.rawCall('click', {}), (e) => {
      assert.equal(e.kind, 'contract_mismatch')
      assert.deepEqual(e.contract, { daemonContract: '0.7.0', sdkContract: '0.8.0' })
      assert.match(e.message, /必须一起升级/)
      return true
    })
  })

  await check('T8 session ended → kind=session_ended', async () => {
    const t = createTransport({
      spawnImpl: () => fakeChild({
        code: 1,
        err: "session 'dsh-win-computer-use' has ended; call start_session to revive it",
      }),
      log: noLog,
    })
    await assert.rejects(t.rawCall('click', {}), (e) => {
      assert.equal(e.kind, 'session_ended')
      return true
    })
  })

  await check('T9 错误识别函数直接可用', () => {
    assert.deepEqual(contractMismatchOf('contract version 0.6.0 does not match SDK 0.8.0'),
      { daemonContract: '0.6.0', sdkContract: '0.8.0' })
    assert.equal(isSessionEndedText('please revive it'), true)
    assert.equal(isSessionEndedText('normal error'), false)
    assert.ok(new DriverCallError('x', { kind: 'exit' }) instanceof Error)
  })

  await check('T10 runOnce 返回 stdout/code，非零不抛', async () => {
    const t = createTransport({
      spawnImpl: () => fakeChild({ out: 'cua-driver 0.53.0\n', code: 1 }),
      log: noLog,
    })
    const r = await t.runOnce(['--version'])
    assert.equal(r.code, 1)
    assert.match(r.stdout, /0\.53\.0/)
  })

  await check('T11 runOnce 超时拒绝', async () => {
    const t = createTransport({
      spawnImpl: () => fakeChild({ close: false }),
      log: noLog,
    })
    await assert.rejects(t.runOnce(['--version'], { timeoutMs: 20 }), (e) => {
      assert.equal(e.kind, 'timeout')
      return true
    })
  })

  console.log(`\n结果：${failures ? `❌ ${failures} 项失败` : '✅ 全部通过'}`)
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
