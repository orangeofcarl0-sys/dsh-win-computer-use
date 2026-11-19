/**
 * run.mjs —— 子进程运行 + 超时/进程树收尾（headless-run 与单测共用）。
 *
 * 关键语义：timer 一触发就先把 timedOut 置 true，再 kill/等待 taskkill；
 * close 事件即使抢在 taskkill 完成前到达，也会带着 timedOut:true resolve。
 * 旧实现把 timedOut 只放在 timer 的 finish 参数里，720s 边界会被 close 抢先记成 false。
 */
import { spawn } from 'node:child_process'

export function runProcess(cmd, cmdArgs, { timeoutMs = 120000, cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, cmdArgs, { cwd, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let done = false
    let timedOut = false
    const finish = (r) => {
      if (done) return
      done = true
      clearTimeout(timer)
      const merged = { ...r, timedOut: Boolean(r.timedOut || timedOut) }
      // 超时后进程可能先自行退出（close 抢跑）；对调用方统一成 TIMEOUT。
      if (merged.timedOut && merged.code !== 'SPAWN_ERR') merged.code = 'TIMEOUT'
      resolve(merged)
    }
    const timer = setTimeout(async () => {
      timedOut = true
      try { p.kill() } catch {}
      // dsh 可能还有子进程；Windows 上用 taskkill /T 收尾，并等待它完成，
      // 否则 oracle 会在旧进程树还在操作桌面时运行。
      if (process.platform === 'win32' && p.pid) {
        await new Promise((res) => {
          let settled = false
          const doneKill = () => { if (!settled) { settled = true; res() } }
          try {
            const k = spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true })
            k.on('close', doneKill)
            k.on('error', doneKill)
          } catch { doneKill() }
          setTimeout(doneKill, 5000)
        })
      }
      finish({ code: 'TIMEOUT', stdout, stderr, timedOut: true })
    }, timeoutMs)
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('error', (e) => finish({ code: 'SPAWN_ERR', stdout, stderr: String(e) }))
    p.on('close', (code) => finish({ code, stdout, stderr }))
  })
}
