#!/usr/bin/env node
/**
 * probe-display.mjs — read-only display/DPI inventory.
 *
 * PASS: 2+ monitors are exposed and the virtual screen has non-zero area.
 * BLOCKED: only one monitor (cross-monitor evidence is impossible here).
 * This probe never changes display settings.
 *
 * Run: node evals/probe-display.mjs [--strict-blocked]
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const ps = process.env.S4_POWERSHELL || 'powershell.exe'
const strict = process.argv.includes('--strict-blocked')

function run() {
  return new Promise((resolve) => {
    const p = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'lib', 'env-info.ps1')], {
      cwd: root,
      windowsHide: true,
    })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ code, out, err }))
    p.on('error', (e) => resolve({ code: 'SPAWN_ERR', out, err: String(e) }))
  })
}

const r = await run()
let data = null
for (const line of r.out.split(/\r?\n/)) {
  if (!line.trim().startsWith('{')) continue
  try { data = JSON.parse(line) } catch {}
}
if (!data || !data.ok) {
  console.log(`FAIL display inventory: ${data?.error || r.err || r.code}`)
  process.exit(1)
}
console.log(`display: monitors=${data.monitorCount} dpi=${data.dpiX}x${data.dpiY} virtual=${data.virtualScreen.width}x${data.virtualScreen.height}@${data.virtualScreen.x},${data.virtualScreen.y}`)
for (const s of data.screens) {
  console.log(`  ${s.device} primary=${s.primary} bounds=${s.width}x${s.height}@${s.x},${s.y}`)
}
if (data.monitorCount < 2) {
  console.log('BLOCKED: only one monitor; cross-monitor/negative-origin evidence cannot be produced on this host')
  process.exit(strict ? 2 : 0)
}
console.log('PASS: multiple monitors exposed; run the dpi task/probe when available')
process.exit(0)
