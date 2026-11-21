#!/usr/bin/env node
/**
 * probe-platform.mjs — read-only platform / suite availability inventory.
 *
 * PASS: win32 + PowerShell are available; the Windows runtime task suite applies.
 * BLOCKED: any other platform (the task suite is Windows-only). Linux is optional
 * and explicitly not a release gate; only `npm run check` / `npm test` are supported.
 *
 * This probe never writes files, installs packages, changes settings, or launches GUI.
 *
 * Run: node evals/probe-platform.mjs [--strict-blocked]
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const strict = process.argv.includes('--strict-blocked')
const tasksDir = join(root, 'tasks')
const tasks = existsSync(tasksDir)
  ? readdirSync(tasksDir).filter((f) => f.endsWith('.md')).length
  : 0

function probePowerShell(exe) {
  return new Promise((resolve) => {
    let done = false
    const finish = (r) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    const p = spawn(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      cwd: root,
      windowsHide: true,
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL') } catch {}
      finish({ ok: false, reason: 'timeout' })
    }, 10000)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => finish({
      ok: code === 0 && out.trim().length > 0,
      reason: code === 0 ? '' : `exit=${code} ${err.trim().slice(0, 120)}`,
      version: out.trim(),
    }))
    p.on('error', (e) => finish({ ok: false, reason: String(e.message || e) }))
  })
}

const candidates = process.platform === 'win32'
  ? [process.env.S4_POWERSHELL || 'powershell.exe']
  : ['pwsh', 'powershell.exe']
let pwsh = null
const failures = []
for (const exe of candidates) {
  const r = await probePowerShell(exe)
  if (r.ok) { pwsh = { exe, version: r.version }; break }
  failures.push(`${exe}: ${r.reason}`)
}

console.log(`platform: ${process.platform} ${process.arch} node=${process.version}`)
console.log(`powershell: ${pwsh ? `${pwsh.exe} ${pwsh.version}` : `unavailable (${failures.join('; ') || 'no candidate'})`}`)
console.log(`tasks: ${tasks} task definitions`)
console.log('linux: optional, non-gate (offline checks only; no Linux task suite)')

if (process.platform === 'win32' && pwsh && tasks > 0) {
  console.log('PASS: Windows runtime task suite is applicable on this host')
  process.exit(0)
}
console.log('BLOCKED: Windows runtime task suite requires win32 + PowerShell; Linux/macOS runtime is not claimed')
process.exit(strict ? 2 : 0)
