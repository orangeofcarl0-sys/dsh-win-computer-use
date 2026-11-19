/**
 * proc-run.test.mjs —— evals/lib/run.mjs 的超时/边界语义。
 *
 * 守住 2026-11-20 t19/t20 二轮的真实缺陷：timer 已触发但 close 抢先时，
 * 旧实现会返回 timedOut:false，把预算耗尽记成普通 fail。
 * 运行：node tests/proc-run.test.mjs
 */
import { runProcess } from '../evals/lib/run.mjs'

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`✅ ${name}`)
  } else {
    failures++
    console.log(`❌ ${name} — ${String(detail).slice(0, 300)}`)
  }
}

const started = Date.now()
const timed = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 300 })
check('P1: 超时进程 timedOut=true/code=TIMEOUT，close 抢跑也不丢标记',
  timed.timedOut === true && timed.code === 'TIMEOUT' && Date.now() - started < 5000,
  JSON.stringify({ code: timed.code, timedOut: timed.timedOut, elapsed: Date.now() - started }))

const normal = await runProcess(process.execPath, ['-e', 'process.exit(0)'], { timeoutMs: 5000 })
check('P2: 正常退出 timedOut=false/code=0',
  normal.timedOut === false && normal.code === 0,
  JSON.stringify({ code: normal.code, timedOut: normal.timedOut }))

const missing = await runProcess('definitely-not-a-real-exe-s4-xyz', [], { timeoutMs: 5000 })
check('P3: spawn 失败 code=SPAWN_ERR 且不误报超时',
  missing.code === 'SPAWN_ERR' && missing.timedOut === false,
  JSON.stringify({ code: missing.code, timedOut: missing.timedOut, stderr: String(missing.stderr).slice(0, 120) }))

console.log(`\n结果：${failures ? '❌ ' + failures + ' 项失败' : '✅ 全部通过'}`)
process.exit(failures ? 1 : 0)
