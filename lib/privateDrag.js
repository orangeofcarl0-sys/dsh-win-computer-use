/**
 * privateDrag.js —— 私有 Windows 拖拽 helper 的 Node 封装。
 *
 * 目的：cua-driver 0.23.2 的 drag 声明了 modifier 但实现不读取；后台 drag 也
 * 无法携带 OS 修饰键状态。这里用持久 PowerShell + Add-Type C# P/Invoke 执行
 * 一次原子手势：前台 -> modifier down -> mouse down -> moves -> mouse up ->
 * modifier up -> 恢复原前台。整个手势在一个 helper 进程内，失败路径 finally
 * 释放按键，避免卡键。
 *
 * 协议：stdin 一行一个 JSON 请求，stdout 一行一个 JSON 响应。坐标是屏幕物理
 * 像素（virtual desktop）；调用方负责从窗口截图坐标映射。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HELPER = fileURLToPath(new URL('../tools/private-drag.ps1', import.meta.url))
const IDLE_MS = 120000

let child = null
let buffer = ''
let inflight = null
let queue = []
let idleTimer = null
let stderrTail = ''
let starting = null

function resetChild(reason) {
  const err = new Error(reason || 'private drag helper exited')
  if (inflight) {
    clearTimeout(inflight.timer)
    inflight.reject(err)
    inflight = null
  }
  for (const item of queue.splice(0)) item.reject(err)
  child = null
  buffer = ''
  starting = null
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}

function armIdle() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (!inflight && queue.length === 0 && child) {
      try { child.stdin.end() } catch { /* ignore */ }
      try { child.kill() } catch { /* ignore */ }
      child = null
    }
  }, IDLE_MS)
  if (typeof idleTimer.unref === 'function') idleTimer.unref()
}

function startChild() {
  if (child) return Promise.resolve()
  if (starting) return starting
  starting = new Promise((resolve, reject) => {
    const ps = process.env.DSH_POWERSHELL || 'powershell.exe'
    const fallbackTemp = process.platform === 'win32'
      ? join(homedir(), 'AppData', 'Local', 'Temp')
      : (process.env.TEMP || process.env.TMP || '')
    const helperTemp = process.env.S4_TEMP || process.env.DSH_TEMP || fallbackTemp
    let proc
    try {
      proc = spawn(ps, [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER,
      ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TEMP: helperTemp, TMP: helperTemp },
      })
    } catch (err) {
      starting = null
      reject(err)
      return
    }
    child = proc
    buffer = ''
    stderrTail = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        if (!line.trim()) continue
        if (!inflight) continue
        const item = inflight
        inflight = null
        clearTimeout(item.timer)
        let parsed
        try { parsed = JSON.parse(line) } catch (err) {
          item.reject(new Error(`private drag helper returned non-JSON: ${line.slice(0, 160)}`))
          pump()
          continue
        }
        item.resolve(parsed)
        armIdle()
        pump()
      }
    })
    proc.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-800) })
    proc.on('error', (err) => {
      const detail = stderrTail ? `: ${stderrTail.slice(0, 300)}` : ''
      resetChild(`private drag helper failed to start${detail}`)
      reject(new Error(`private drag helper failed to start${detail}${err?.message ? ` (${err.message})` : ''}`))
    })
    proc.on('exit', (code, signal) => {
      const was = child
      resetChild(`private drag helper exited (code=${code ?? 'null'} signal=${signal ?? 'null'})${stderrTail ? `: ${stderrTail.slice(0, 300)}` : ''}`)
      if (was) {
        try { was.stdout.removeAllListeners() } catch { /* ignore */ }
      }
    })
    starting = null
    // Wait for the first compile/ready marker. The helper does not emit one, so
    // resolve on spawn; if Add-Type fails, the first request will reject/return.
    resolve()
  })
  return starting
}

function pump() {
  if (inflight || queue.length === 0) return
  startChild().then(() => {
    if (!child || inflight || queue.length === 0) return
    const item = queue.shift()
    inflight = item
    item.timer = setTimeout(() => {
      if (inflight === item) {
        inflight = null
        item.reject(new Error(`private drag helper timeout after ${item.timeoutMs}ms`))
        try { child.stdin.end() } catch { /* ignore */ }
        try { child.kill() } catch { /* ignore */ }
        child = null
        pump()
      }
    }, item.timeoutMs)
    if (typeof item.timer.unref === 'function') item.timer.unref()
    try {
      child.stdin.write(`${JSON.stringify(item.req)}\n`)
    } catch (err) {
      clearTimeout(item.timer)
      inflight = null
      item.reject(err)
      pump()
    }
  }).catch((err) => {
    const item = queue.shift()
    if (item) item.reject(err)
    pump()
  })
}

/**
 * 执行一次私有拖拽。
 * @param {object} req { hwnd, fromX, fromY, toX, toY, steps, durationMs, dwellMs, button, modifier }
 * @param {{timeoutMs?:number}} opts
 * @returns {Promise<{ok:boolean, code?:string, sent?:number, stuckButton?:boolean, stuckModifiers?:string, detail?:string}>}
 */
export function privateDrag(req, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000
  return new Promise((resolve, reject) => {
    queue.push({ req, resolve, reject, timeoutMs, timer: null })
    pump()
  })
}

/** 测试/清理：结束 helper 并拒绝未完成请求。 */
export function stopPrivateDrag() {
  if (child) {
    try { child.stdin.end() } catch { /* ignore */ }
    try { child.kill() } catch { /* ignore */ }
  }
  resetChild('private drag helper stopped')
}
