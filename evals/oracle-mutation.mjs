/**
 * oracle-mutation.mjs — prove oracles reject wrong-but-plausible artifacts.
 *
 * For every mutable task:
 *   cleanup -> setup -> simulate -> oracle (must PASS)
 *   -> release (close the app holding the artifact)
 *   -> mutate (apply.ps1) -> oracle (must FAIL, exit 1)
 *   -> cleanup (plus exact-path cleanup for t18 Downloads)
 *
 * This complement to verify-oracles catches false positives that an empty
 * directory cannot: wrong text, wrong cell, missing chart, string "false"
 * where a boolean is required, case-only drift, bad SHA-256, etc.
 *
 * t04/t07 are skipped: their oracles read live GUI state, not an artifact.
 * t13 is skipped: ac2:none (real network task).
 *
 * Run: node evals/oracle-mutation.mjs [--tasks t01,t03,...]
 */
import { spawn } from 'node:child_process'
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)))
const TABSTATE = join(root, 'lib', 'tabstate.ps1')
const TEMP = process.env.S4_TEMP || join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '', 'Temp')
const ENV = { ...process.env, TEMP, TMP: TEMP }
const POWERSHELL = process.env.S4_POWERSHELL || 'powershell.exe'
const args = process.argv.slice(2)
const tasksArg = (() => {
  const i = args.indexOf('--tasks')
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''
})()

const MUTABLE = new Set([
  't01', 't03', 't05', 't06', 't09', 't10', 't11', 't12', 't14', 't15',
  't16', 't17', 't18', 't19', 't20', 'p01', 'p02', 'p03', 'wa2', 'x1',
])
const SKIPPED = new Map([
  ['t04', 'live GUI state (Calculator display), no artifact to mutate'],
  ['t07', 'live GUI state (window placement), no artifact to mutate'],
  ['t13', 'ac2:none (real network task)'],
])

const taskFiles = readdirSync(join(root, 'tasks')).filter((f) => f.endsWith('.md'))
const taskMeta = new Map(taskFiles.map((f) => {
  const id = f.replace(/\.md$/, '').split('-')[0]
  const md = readFileSync(join(root, 'tasks', f), 'utf8').replace(/\r\n/g, '\n')
  const isolation = (/^\s*-\s*\*\*isolation:\s*([^*\n]+?)\s*\*\*/m.exec(md) || /^\s*-\s*isolation:\s*([^\n]+)/m.exec(md) || [])[1]?.trim() || 'notepad'
  return [id, { id, isolation }]
}))
const ids = [...MUTABLE].filter((id) => !tasksArg || tasksArg.split(',').map((s) => s.trim().toLowerCase()).includes(id.toLowerCase())).sort()
if (!ids.length) {
  console.error(`oracle-mutation: no mutable tasks matched (tasks=${tasksArg || 'all'})`)
  process.exit(2)
}
for (const id of SKIPPED.keys()) {
  if (tasksArg && tasksArg.split(',').map((s) => s.trim().toLowerCase()).includes(id)) {
    console.log(`SKIP ${id}: ${SKIPPED.get(id)}`)
  }
}
const needsTabState = ids.some((id) => taskMeta.get(id)?.isolation !== 'dirty')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const LOG_DIR = join(root, 'mutation-runs', STAMP)
mkdirSync(LOG_DIR, { recursive: true })

function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve()
    const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    const t = setTimeout(resolve, 5000)
    k.on('close', () => { clearTimeout(t); resolve() })
    k.on('error', () => { clearTimeout(t); resolve() })
  })
}

function runPsArgs(script, argv, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const p = spawn(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...argv], {
      cwd: root,
      env: ENV,
      windowsHide: true,
    })
    let out = ''
    let err = ''
    let done = false
    const finish = (r) => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve({ ...r, dur: Date.now() - started })
    }
    const t = setTimeout(async () => {
      try { p.kill('SIGKILL') } catch {}
      await killTree(p.pid)
      finish({ code: 'TIMEOUT', out, err: (err + '\n[killed by mutation timeout]').trim() })
    }, timeoutMs)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => finish({ code, out, err }))
    p.on('error', (e) => finish({ code: 'SPAWN_ERR', out, err: String(e) }))
  })
}

function runPs(script, id, timeoutMs = 120000) {
  return runPsArgs(script, [id], timeoutMs)
}

function parseJson(out) {
  const lines = out.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
  if (lines.length === 0) return null
  try { return JSON.parse(lines[lines.length - 1]) } catch { return null }
}

function writeStep(id, name, r) {
  const base = join(LOG_DIR, `${id}-${name}`)
  try {
    writeFileSync(`${base}.stdout.txt`, r.out || '')
    writeFileSync(`${base}.stderr.txt`, r.err || '')
    writeFileSync(`${base}.json`, JSON.stringify({ code: r.code, dur: r.dur, json: parseJson(r.out) }, null, 2))
  } catch { /* 日志失败不阻断验证 */ }
}

function removeMutationCleanup(paths, rec) {
  for (const p of paths || []) {
    const text = String(p || '')
    if (!/^[A-Za-z]:\\/.test(text) || !/[\\/]Downloads[\\/]/i.test(text) || !/\.pdf$/i.test(text)) {
      rec.notes.push(`refused unsafe mutation cleanup path: ${text}`)
      rec.status = 'FAIL'
      continue
    }
    try {
      rmSync(text, { force: true })
      rec.notes.push(`removed mutation PDF: ${text}`)
    } catch (err) {
      rec.notes.push(`failed to remove mutation PDF: ${text}: ${err.message}`)
      rec.status = 'FAIL'
    }
  }
}

let tb = { ok: true, skipped: true }
if (needsTabState) {
  const r = await runPsArgs(TABSTATE, ['backup'], 60000)
  tb = parseJson(r.out)
  if (!tb?.ok) {
    console.error(`tabstate backup failed: ${tb?.reason || r.err || r.code}`)
    process.exit(2)
  }
  console.log(`tabstate backup: ${tb.backup || '(none)'} moved=${tb.moved ?? 0}`)
} else {
  console.log('tabstate: skipped (dirty tasks only)')
}

const results = []
let failed = 0
let blocked = 0
let envs = 0
for (const id of ids) {
  const s = (kind) => join(root, kind, `${id}.ps1`)
  const rec = { id, status: null, setupOk: false, baselineOk: false, mutationOk: false, mutatedOracleCode: null, release: null, changes: [], notes: [] }
  const cleanupStep = async (phase) => {
    const r = await runPs(s('cleanup'), id, 60000)
    writeStep(id, `cleanup-${phase}`, r)
    const j = parseJson(r.out)
    if (r.code !== 0 || j?.ok === false) { rec.status = 'FAIL'; rec.notes.push(`${phase} cleanup failed: code=${r.code}`) }
    if (j?.dirty) { rec.status = 'FAIL'; rec.notes.push(`${phase} cleanup dirty`) }
    if (r.code === 2 || r.code === 'TIMEOUT' || r.code === 'SPAWN_ERR') { rec.envError = `${phase} cleanup: ${r.code}` }
  }

  await cleanupStep('initial')
  let stop = false
  try {
    if (!stop) {
      const setup = await runPs(s('setup'), id)
      writeStep(id, 'setup', setup)
      const sj = parseJson(setup.out)
      rec.setupOk = setup.code === 0
      if (!rec.setupOk) {
        rec.status = (setup.code === 2 || sj?.envError) ? 'ENV' : 'FAIL'
        rec.notes.push(`setup: ${sj?.envError || setup.err || setup.code}`)
        stop = true
      }
    }
    if (!stop) {
      const sim = await runPs(s('simulate'), id)
      writeStep(id, 'simulate', sim)
      const simj = parseJson(sim.out)
      if (sim.code !== 0) {
        rec.status = (sim.code === 2 || simj?.envError) ? 'ENV' : 'FAIL'
        rec.notes.push(`simulate: ${simj?.envError || sim.err || sim.code}`)
        stop = true
      }
    }
    if (!stop) {
      const base = await runPs(s('oracle'), id)
      writeStep(id, 'oracle-baseline', base)
      rec.baselineOk = base.code === 0
      if (!rec.baselineOk) {
        rec.notes.push(`baseline oracle did not pass (code=${base.code}); mutation cannot be judged`)
        stop = true
      }
    }
    if (!stop) {
      const rel = await runPs(join(root, 'mutate', 'release.ps1'), id, 90000)
      writeStep(id, 'release', rel)
      const relj = parseJson(rel.out)
      rec.release = relj
      if (rel.code !== 0 || relj?.ok === false) {
        rec.status = 'BLOCKED'
        rec.notes.push(`release: ${relj?.reason || rel.err || rel.code}`)
        stop = true
      }
    }
    if (!stop) {
      const mut = await runPs(join(root, 'mutate', 'apply.ps1'), id, 90000)
      writeStep(id, 'mutate', mut)
      const mutj = parseJson(mut.out)
      rec.mutationOk = mut.code === 0 && mutj?.ok === true
      rec.changes = mutj?.changes || []
      if (!rec.mutationOk) {
        rec.notes.push(`mutation failed: ${mutj?.error || mut.err || mut.code}`)
        stop = true
      } else {
        const after = await runPs(s('oracle'), id, 150000)
        writeStep(id, 'oracle-mutated', after)
        rec.mutatedOracleCode = after.code
        if (after.code !== 1) {
          rec.notes.push(`oracle ${after.code === 0 ? 'ACCEPTED the mutated artifact' : 'did not return 1'} (code=${after.code})`)
          stop = true
        } else {
          removeMutationCleanup(mutj?.cleanup, rec)
          if (!rec.status) rec.status = 'PASS'
        }
      }
    }
  } finally {
    await cleanupStep('final')
  }
  if (!rec.status) rec.status = 'FAIL'
  if (rec.status === 'PASS' && (rec.envError || rec.notes.some((n) => /cleanup failed|cleanup dirty/.test(n)))) {
    rec.status = rec.envError ? 'ENV' : 'FAIL'
  }
  results.push(rec)
  if (rec.status === 'FAIL') failed++
  if (rec.status === 'ENV') envs++
  if (rec.status === 'BLOCKED') blocked++
  console.log(`${rec.status} ${id} baseline=${rec.baselineOk} mutatedOracle=${rec.mutatedOracleCode} changes=${JSON.stringify(rec.changes).slice(0, 120)}${rec.notes.length ? ' notes=' + rec.notes.join(' ; ') : ''}`)
}

let tr = { ok: true, skipped: true }
if (needsTabState) {
  const r = await runPsArgs(TABSTATE, ['restore'], 60000)
  tr = parseJson(r.out)
  if (!tr?.ok) {
    console.error(`tabstate restore failed: ${tr?.reason || r.err || r.code}`)
    if (tr?.backup) console.error(`backup kept at: ${tr.backup}`)
    failed++
  }
}
try {
  writeFileSync(join(LOG_DIR, 'summary.json'), JSON.stringify({
    startedAt: STAMP, tasks: ids, skipped: [...SKIPPED.entries()], tabState: { backup: tb, restore: tr }, results,
  }, null, 2))
} catch { /* 忽略 */ }

const pass = results.filter((r) => r.status === 'PASS').length
console.log(`\noracle-mutation: ${pass}/${ids.length} PASS${blocked ? ` + ${blocked} BLOCKED` : ''}${envs ? ` + ${envs} ENV` : ''}${failed ? ` (${failed} FAIL)` : ''}`)
console.log(`logs -> ${LOG_DIR}`)
process.exit(failed ? 1 : 0)
