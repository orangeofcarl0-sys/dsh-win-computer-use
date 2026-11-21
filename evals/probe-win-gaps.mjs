#!/usr/bin/env node
/**
 * probe-win-gaps.mjs — read-only inventory for Windows-only gaps.
 *
 * It does not launch apps or change settings. Missing VS Code/VLC/Settings
 * evidence is BLOCKED, not PASS.
 *
 * Run: node evals/probe-win-gaps.mjs [--strict-blocked]
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const ps = process.env.S4_POWERSHELL || 'powershell.exe'
const strict = process.argv.includes('--strict-blocked')

const r = await new Promise((resolve) => {
  const p = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'lib', 'win-gaps.ps1')], {
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

let data = null
for (const line of r.out.split(/\r?\n/)) {
  if (!line.trim().startsWith('{')) continue
  try { data = JSON.parse(line) } catch {}
}
if (!data || !data.ok) {
  console.log(`FAIL win gaps inventory: ${r.err || r.code}`)
  process.exit(1)
}
for (const [k, v] of Object.entries(data.paths)) {
  console.log(`${v ? 'PASS' : 'BLOCKED'} ${k}: ${v || 'not installed'}`)
}
console.log(`${data.cjk ? 'PASS' : 'BLOCKED'} cjk-language: ${data.languages.join(', ') || 'none'}`)
console.log('NOTE: VS Code/VLC/Settings/IME still need plugin probes/tasks before they count as covered.')
process.exit(strict ? 2 : 0)
