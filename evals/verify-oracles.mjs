/**
 * AC2 oracle 双向独立验证：对每条任务
 *   cleanup → setup → oracle        （空跑必须 FAIL，exit 1）
 *   simulate → oracle → oracle      （成功态必须 PASS ×2，结果一致）
 *   cleanup                          （环境清干净）
 *
 * 2026-11-15 增强：
 * - 每个任务最终 cleanup 放在 finally 里，env error/timeout 也会清理；
 * - cleanup 的 dirty/ok 被消费，不再只看 exit code；
 * - 环境阻塞（Calculator/剪贴板/TabState）单独记 ENV，不冒充插件 fail；
 * - 每步 stdout/stderr/json + summary 写到 evals/verify-runs/<stamp>/；
 * - timeout 用 taskkill /T /F 收进程树并等待。
 */
import { spawn } from 'node:child_process'
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)))
const TABSTATE = join(root, 'lib', 'tabstate.ps1')
const TEMP = process.env.S4_TEMP || join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '', 'Temp')
const ENV = { ...process.env, TEMP, TMP: TEMP }
const args = process.argv.slice(2)
const tasksArg = (() => {
  const i = args.indexOf('--tasks')
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''
})()
const stageArg = (() => {
  const i = args.indexOf('--stage')
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''
})()
const stageFilter = stageArg && stageArg !== 'all'
  ? stageArg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  : []

/** 读取任务 md 的 `- **name: value**` 或 `- name: value` 字段。 */
function field(md, name) {
  const re = new RegExp(`^\\s*-\\s*\\*\\*${name}:\\s*([^*\\n]+?)\\s*\\*\\*`, 'm')
  const plain = new RegExp(`^\\s*-\\s*${name}:\\s*([^\\n]+)`, 'm')
  const m = md.match(re) || md.match(plain)
  return m ? m[1].trim() : ''
}

const taskFiles = readdirSync(join(root, 'tasks')).filter((f) => f.endsWith('.md'))
const taskMeta = new Map(taskFiles.map((f) => {
  const id = f.replace(/\.md$/, '').split('-')[0]
  const md = readFileSync(join(root, 'tasks', f), 'utf8').replace(/\r\n/g, '\n')
  const isolation = field(md, 'isolation') || 'notepad'
  const ac2 = field(md, 'ac2') || 'full'
  const stages = (field(md, 'stages') || field(md, 'stage')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  return [id, { id, isolation, ac2, stages }]
}))
const ORACLE_IDS = [...taskMeta.keys()]
  .filter((id) => !tasksArg || tasksArg.split(',').map((s) => s.trim().toLowerCase()).includes(id.toLowerCase()))
  .filter((id) => !stageFilter.length || taskMeta.get(id).stages.some((s) => stageFilter.includes(s)))
  .sort()
if (!ORACLE_IDS.length) {
  console.error(`verify-oracles: no tasks matched (stage=${stageArg || 'all'}, tasks=${tasksArg || 'all'})`)
  process.exit(2)
}
const needsTabState = ORACLE_IDS.some((id) => taskMeta.get(id)?.isolation !== 'dirty')
const POWERSHELL = process.env.S4_POWERSHELL || 'powershell.exe'
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const LOG_DIR = join(root, 'verify-runs', STAMP)
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

function runPsArgs(script, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const p = spawn(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
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
      finish({ code: 'TIMEOUT', out, err: (err + '\n[killed by verify timeout]').trim() })
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

// Same isolation as headless-run, but only for Notepad tasks. Dirty-only
// selections must not touch the user's TabState or require closing Notepad.
let tbJson = { ok: true, skipped: true }
if (needsTabState) {
  const tb = await runPsArgs(TABSTATE, ['backup'], 60000)
  tbJson = parseJson(tb.out)
  if (!tbJson?.ok) {
    console.error(`tabstate backup failed: ${tbJson?.reason || tb.err || tb.code}`)
    process.exit(2)
  }
  console.log(`tabstate backup: ${tbJson.backup || '(none)'} moved=${tbJson.moved ?? 0}${tbJson.already ? ' (already active)' : ''}`)
} else {
  console.log('tabstate: skipped (dirty tasks only)')
}

const results = []
let failed = 0
let envs = 0
for (const id of ORACLE_IDS) {
  const s = (k) => join(root, k, `${id}.ps1`)
  const rec = {
    id, stages: taskMeta.get(id)?.stages || [], setupOk: false, emptyFail: false, simPass: false, simRepeat: false,
    cleanupOk: true, cleanupDirty: false, envError: null, envBlocked: false, ac2Skip: taskMeta.get(id)?.ac2 === 'none', notes: [],
  }
  const st = existsSync(s('setup'))

  async function cleanupStep(phase) {
    if (!existsSync(s('cleanup'))) return
    const r = await runPs(s('cleanup'), id, 60000)
    writeStep(id, `cleanup-${phase}`, r)
    const j = parseJson(r.out)
    if (r.code !== 0 || j?.ok === false) rec.cleanupOk = false
    if (j?.dirty) {
      rec.cleanupDirty = true
      rec.cleanupOk = false
      rec.notes.push(`${phase} cleanup dirty: ${JSON.stringify(j.checks || []).slice(0, 240)}`)
    }
    if (r.code === 'TIMEOUT' || r.code === 'SPAWN_ERR') {
      rec.envError = rec.envError || `${phase} cleanup: ${r.code} ${(r.err || '').slice(0, 240)}`
    }
  }

  await cleanupStep('initial')
  try {
    const steps = [
      ...(st ? [['setup', s('setup'), 120]] : []),
      ['oracle-empty', s('oracle'), 120],
      ...(rec.ac2Skip ? [] : [
        ['simulate', s('simulate'), 120],
        ['oracle-pass', s('oracle'), 120],
        ['oracle-pass-2', s('oracle'), 120],
      ]),
    ]
    let emptyCode = null
    for (const [name, script, to] of steps) {
      if (!existsSync(script)) { rec.notes.push(`${name}: script missing`); continue }
      const r = await runPs(script, id, to * 1000)
      writeStep(id, name, r)
      const j = parseJson(r.out)
      if (name === 'oracle-empty') emptyCode = r.code
      if (name === 'setup') rec.setupOk = r.code === 0
      if (name === 'oracle-pass') rec.simPass = r.code === 0
      if (name === 'oracle-pass-2') rec.simRepeat = r.code === 0
      if (r.code === 2 || (j && j.envError)) rec.envBlocked = true
      if (r.code === 2 || r.code === 'SPAWN_ERR' || r.code === 'TIMEOUT') {
        rec.envError = `${name}: code=${r.code} ${(j?.envError || r.err || '').slice(0, 300)}`
        break
      }
      if (name === 'setup' && r.code !== 0) {
        rec.notes.push('setup did not reach ok: ' + JSON.stringify(j?.checks || j?.envError || r.code).slice(0, 240))
      }
      if (r.code !== 0 && !['oracle-empty', 'setup'].includes(name)) {
        rec.notes.push(`${name}: code=${r.code} ${(r.err || '').slice(0, 200)}`)
      }
    }
    rec.emptyFail = emptyCode === 1
  } finally {
    await cleanupStep('final')
  }

  rec.envBlocked = rec.envBlocked || (Boolean(rec.envError)
    && /calculator|clipboard|tabstate|tab state|notepad process|backup dir|network|arxiv|paint|powerpoint|excel|browser|edge|chrome/i.test(rec.envError))
  const baseOk = rec.setupOk && rec.emptyFail && rec.cleanupOk && !rec.cleanupDirty && !rec.envError
  const ok = baseOk && (rec.ac2Skip || (rec.simPass && rec.simRepeat))
  const status = rec.envBlocked ? 'ENV' : (!baseOk ? 'FAIL' : (rec.ac2Skip ? 'SKIP' : (ok ? 'PASS' : 'FAIL')))
  rec.status = status
  if (status === 'FAIL') failed++
  if (status === 'ENV') envs++
  console.log(`${status} ${id} setup=${rec.setupOk} emptyFail=${rec.emptyFail} simPass=${rec.simPass} repeat=${rec.simRepeat} cleanup=${rec.cleanupOk}${rec.cleanupDirty ? ' dirty' : ''}${rec.envError ? ' envError=' + rec.envError : ''}${rec.notes.length ? ' notes=' + rec.notes.join(' ; ') : ''}`)
  results.push(rec)
}

let trJson = { ok: true, skipped: true }
if (needsTabState) {
  const tr = await runPsArgs(TABSTATE, ['restore'], 60000)
  trJson = parseJson(tr.out)
  if (!trJson?.ok) {
    console.error(`tabstate restore failed: ${trJson?.reason || tr.err || tr.code}`)
    if (trJson?.backup) console.error(`backup kept at: ${trJson.backup}`)
    failed++
  }
}
try {
  writeFileSync(join(LOG_DIR, 'summary.json'), JSON.stringify({
    startedAt: STAMP, stage: stageArg || null, stageFilter, tabState: { backup: tbJson, restore: trJson }, results,
  }, null, 2))
} catch { /* 忽略 */ }

const pass = results.filter((r) => r.status === 'PASS').length
console.log(`\nverify-oracles: ${pass}/${ORACLE_IDS.length} PASS${envs ? ` + ${envs} ENV` : ''}${failed ? ` (${failed} FAIL)` : ''} stage=${stageArg || 'all'}`)
console.log(`logs -> ${LOG_DIR}`)
process.exit(failed ? 1 : 0)
