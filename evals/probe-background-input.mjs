/**
 * 真机探针：实验性后台输入通道（B0/B1/B2/B3）。
 *
 * 自建一个 WinForms 消息窗口 + 一个 RegisterTouchWindow 的原生窗口 + 遮挡窗口；
 * 直接调用 lib/backgroundInput.js 的真实 helper，验证：
 *  - B0 posted click/text/key（不移动光标）
 *  - B1 synthetic touch click（不移动光标）；遮挡时失败关闭
 *  - B2 cursor anchored（BlockInput 在部分会话不可用 → BLOCKED，不冒充 PASS）
 *  - B3 window anchored（点击后窗口还原、光标不动）
 *
 * 清理只按本探针的 HWND / 子进程 PID，不按进程名杀；不加入 npm test。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBackgroundInputClient } from '../lib/backgroundInput.js'

const isWin = process.platform === 'win32'
const results = []
let failed = 0
let blocked = 0

function record(name, status, detail = '', data = undefined) {
  results.push({ name, status, detail, data })
  if (status === 'FAIL') failed++
  if (status === 'BLOCKED') blocked++
  const icon = status === 'PASS' ? '✅' : status === 'BLOCKED' ? '⛔' : '❌'
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

function amElevated() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    ], { encoding: 'utf8', timeout: 10000, windowsHide: true })
    return /true/i.test(String(out))
  } catch {
    return false
  }
}

/**
 * --elevated: run the whole probe in an elevated child (UAC). Strict B2 needs
 * a High IL/UIAccess process; self-elevating the probe is safer than adding a
 * production elevation path. The child writes its stdout to a temp file.
 */
async function relaunchElevated() {
  const dir = mkdtempSync(join(tmpdir(), 's4-bg-elev-'))
  const outFile = join(dir, 'out.txt')
  const errFile = join(dir, 'err.txt')
  const childScript = join(dir, 'child.ps1')
  const launcher = join(dir, 'launch.ps1')
  const script = fileURLToPath(import.meta.url)
  const root = dirname(script)
  // -Verb RunAs cannot be combined with -RedirectStandardOutput (different
  // Start-Process parameter sets), so the elevated child redirects internally.
  writeFileSync(childScript, [
    '$ErrorActionPreference = "Stop"',
    `Set-Location -LiteralPath ${psQuote(root)}`,
    // Decode Node's UTF-8 on the pipeline; PowerShell 5.1 file redirection would
    // otherwise write UTF-16 and the parent would read mojibake.
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    `$stdout = & ${psQuote(process.execPath)} ${psQuote(script)} --elevated-child 2>&1 | Out-String`,
    `[IO.File]::WriteAllText(${psQuote(outFile)}, $stdout, (New-Object System.Text.UTF8Encoding($false)))`,
    'exit $LASTEXITCODE',
    '',
  ].join('\n'), 'utf8')
  const childArgs = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${childScript}"`
  writeFileSync(launcher, [
    '$ErrorActionPreference = "Stop"',
    `$p = Start-Process -FilePath ${psQuote('powershell.exe')} -ArgumentList ${psQuote(childArgs)} -WorkingDirectory ${psQuote(root)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden`,
    'exit $p.ExitCode',
    '',
  ].join('\n'), 'utf8')
  const result = await new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (v) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(v)
    }
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let err = ''
    ps.stderr.on('data', (d) => { err += d })
    ps.on('error', (e) => finish({ code: -1, err: String(e.message || e) }))
    ps.on('close', (code) => finish({ code, err }))
    timer = setTimeout(() => {
      try { ps.kill() } catch { /* ignore */ }
      finish({ code: -2, err: 'timeout waiting for UAC/result (180s)' })
    }, 180000)
  })
  const out = existsSync(outFile) ? readFileSync(outFile, 'utf8') : ''
  const err = [existsSync(errFile) ? readFileSync(errFile, 'utf8') : '', result.err].filter(Boolean).join('\n')
  if (out) process.stdout.write(out)
  if (err) process.stderr.write(err)
  if (!out) {
    console.log('⛔ 提权运行未返回结果（UAC 被取消或超时）；严格 B2 保持 BLOCKED')
  }
  if (!process.env.S4_KEEP) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  } else {
    console.log(`S4_KEEP: elevated probe files in ${dir}`)
  }
  return out ? Number(result.code) || 0 : 0
}

if (isWin && process.argv.includes('--elevated') && !process.argv.includes('--elevated-child') && !amElevated()) {
  const code = await relaunchElevated()
  process.exit(code)
}

function readLog(file) {
  try { return readFileSync(file, 'utf8') } catch { return '' }
}

/**
 * Wait until the physical cursor is still for ~0.7s. Dirty desktops otherwise
 * flip B1/B3 to BLOCKED or make the helper return desktop_busy; retry a few times.
 */
async function waitQuiet(hwnd, pid, tries = 3) {
  for (let t = 0; t < tries; t += 1) {
    let prev = null
    let still = true
    for (let i = 0; i < 6; i += 1) {
      const p = await client.probe({ hwnd, pid })
      if (!p || p.ok !== true) return false
      if (prev) {
        const d = Math.abs(Number(p.cursor?.x) - prev.x) + Math.abs(Number(p.cursor?.y) - prev.y)
        if (d > 2) { still = false; break }
      }
      prev = { x: Number(p.cursor?.x), y: Number(p.cursor?.y) }
      await sleep(120)
    }
    if (still) return true
    await sleep(800)
  }
  return false
}

const appPs1 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'lib', 'background-input-app.ps1'), 'utf8')

function findWindowPid(hwnd) {
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$h=[int64]${hwnd}; $p=Get-Process | Where-Object { $_.MainWindowHandle -eq $h } | Select-Object -First 1; if ($p) { $p.Id } else { '' }`], { windowsHide: true })
    let out = ''
    ps.stdout.on('data', (d) => { out += d })
    ps.on('close', () => resolve(Number(String(out).trim()) || 0))
    ps.on('error', () => resolve(0))
  })
}

async function stopApp(app, state, tempDir) {
  try { writeFileSync(state.stopFile, '1') } catch { /* ignore */ }
  await sleep(1200)
  if (app.exitCode === null) {
    // Only kill our own app process after verifying the command line contains this probe's app.ps1.
    const check = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${app.pid}" | Select-Object -First 1; if ($p) { $p.CommandLine } else { '' }`], { windowsHide: true })
    let cmd = ''
    check.stdout.on('data', (d) => { cmd += d })
    await new Promise((resolve) => check.on('close', resolve))
    if (String(cmd).includes('probe-background-input-app.ps1') || String(cmd).includes(tempDir)) {
      try { app.kill() } catch { /* ignore */ }
    }
  }
}

let tempDir = ''
let app = null
let client = null
let state = null
try {
  if (!isWin) {
    record('环境', 'BLOCKED', '非 Windows；后台输入 helper 不适用')
    throw Object.assign(new Error('non-windows'), { blocked: true })
  }
  tempDir = mkdtempSync(join(tmpdir(), 's4-background-input-'))
  const appPath = join(tempDir, 'probe-background-input-app.ps1')
  const stateFile = join(tempDir, 'state.json')
  const logFile = join(tempDir, 'events.log')
  const coverFile = join(tempDir, 'cover.txt')
  const stopFile = join(tempDir, 'stop.txt')
  writeFileSync(appPath, appPs1, 'utf8')
  app = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', appPath,
    '-StateFile', stateFile, '-LogFile', logFile, '-CoverFile', coverFile, '-StopFile', stopFile], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let appOut = ''
  app.stdout.on('data', (d) => { appOut += d })
  app.stderr.on('data', (d) => { appOut += d })
  for (let i = 0; i < 80; i += 1) {
    if (existsSync(stateFile)) break
    await sleep(200)
  }
  if (!existsSync(stateFile)) throw new Error(`probe app did not start: ${appOut.slice(0, 400)}`)
  state = JSON.parse(readFileSync(stateFile, 'utf8'))
  state.logFile = logFile
  state.wndLog = logFile + '.wnd'
  state.touchOnlyLog = logFile + '.touch'
  state.mouseOnlyLog = logFile + '.mouse'
  state.coverFile = coverFile
  state.stopFile = stopFile

  client = createBackgroundInputClient()
  if (!client.available) throw new Error('background-input helper unavailable (tools/background-input.ps1 missing)')

  const m = await client.probe({ hwnd: state.message, pid: state.pid })
  if (!m || m.ok !== true) throw new Error(`probe message failed: ${JSON.stringify(m)}`)
  const btn = { x: m.clientOrigin.x + 50, y: m.clientOrigin.y + 50 }
  const edit = { x: m.clientOrigin.x + 50, y: m.clientOrigin.y + 120 }
  const cursor0 = `${m.cursor.x},${m.cursor.y}`
  record('自建窗口', 'PASS', `message=${state.message} pointer=${state.pointer} pid=${state.pid} origin=${m.clientOrigin.x},${m.clientOrigin.y} rect=${m.windowRect.left},${m.windowRect.top}`)

  writeFileSync(logFile, '')
  const b0 = await client.postMouse({ hwnd: state.message, pid: state.pid, x: btn.x, y: btn.y, button: 'left', count: 1 })
  await sleep(350)
  record('B0 posted click', b0?.ok && /MOUSEDOWN/.test(readLog(state.wndLog)) ? 'PASS' : 'FAIL', JSON.stringify(b0) + ' log=' + JSON.stringify(readLog(state.wndLog).slice(-120)))

  const text = Buffer.from('probe', 'utf8').toString('base64')
  const bt = await client.postText({ hwnd: state.message, pid: state.pid, hasPoint: true, x: edit.x, y: edit.y, textB64: text, append: true })
  await sleep(400)
  record('B0 posted text', bt?.ok && /CHAR:/.test(readLog(state.wndLog)) ? 'PASS' : 'FAIL', JSON.stringify(bt) + ' log=' + JSON.stringify(readLog(state.wndLog).slice(-120)))

  await client.postMouse({ hwnd: state.message, pid: state.pid, x: edit.x, y: edit.y, button: 'left', count: 1 })
  const bk = await client.postKey({ hwnd: state.message, pid: state.pid, vk: 0x41, extended: false })
  await sleep(350)
  record('B0 posted key', bk?.ok && /KEYDOWN:65/.test(readLog(state.wndLog)) ? 'PASS' : 'FAIL', JSON.stringify(bk) + ' log=' + JSON.stringify(readLog(state.wndLog).slice(-120)))

  const m2 = await client.probe({ hwnd: state.message, pid: state.pid })
  const b0Moved = [b0, bt, bk].some((x) => x?.side_effects?.cursorMoved === true)
  record('B0 不移动光标', b0Moved === false ? 'PASS' : 'FAIL', `cursor0=${cursor0} now=${m2?.cursor?.x},${m2?.cursor?.y}`)

  const p = await client.probe({ hwnd: state.pointer, pid: state.pid })
  if (!p || p.ok !== true) throw new Error(`probe pointer failed: ${JSON.stringify(p)}`)
  const pc = { x: p.clientOrigin.x + Math.floor(p.clientRect.width / 2), y: p.clientOrigin.y + Math.floor(p.clientRect.height / 2) }
  writeFileSync(state.wndLog, '')
  const pm = await client.postMouse({ hwnd: state.pointer, pid: state.pid, x: pc.x, y: pc.y, button: 'left', count: 1 })
  await sleep(300)
  record('pointer WndProc 可达', /MOUSEDOWN|TOUCHDOWN|CHAR:|KEYDOWN/.test(readLog(state.wndLog)) ? 'PASS' : 'FAIL', JSON.stringify(pm) + ' log=' + JSON.stringify(readLog(state.wndLog).slice(-200)) + ' wnd=' + state.wndLog + ' app=' + JSON.stringify(appOut.slice(-300)))
  await waitQuiet(state.pointer, state.pid)
  writeFileSync(state.wndLog, '')
  const s1 = await client.syntheticClick({ hwnd: state.pointer, pid: state.pid, x: pc.x, y: pc.y })
  await sleep(350)
  const b1log = readLog(state.wndLog)
  if (s1?.ok && /TOUCHDOWN|WMTOUCH/.test(b1log)) record('B1 synthetic touch', 'PASS', JSON.stringify(s1) + ' log=' + JSON.stringify(b1log.slice(-200)))
  else if (s1?.code === 'desktop_busy') record('B1 synthetic touch', 'BLOCKED', '静默预检失败（桌面光标仍在移动）：' + JSON.stringify(s1))
  else record('B1 synthetic touch', 'FAIL', JSON.stringify(s1) + ' log=' + JSON.stringify(b1log.slice(-200)))
  const p2 = await client.probe({ hwnd: state.pointer, pid: state.pid })
  const b1Drift = p2 && p2.cursor && p.cursor ? Math.abs(p2.cursor.x - p.cursor.x) + Math.abs(p2.cursor.y - p.cursor.y) : 999
  const helperDrift = Number(s1?.cursorDrift)
  if (s1?.side_effects?.cursorMoved === true) {
    record('B1 不移动光标', 'FAIL', JSON.stringify({ p: p?.cursor, p2: p2?.cursor, drift: b1Drift, helperDrift, side: s1?.side_effects }))
  } else if (Number.isFinite(helperDrift) && helperDrift <= 2) {
    // The helper samples around the injection itself; external probe-level drift
    // after the injection is recorded but not attributed to B1.
    record('B1 不移动光标', 'PASS', JSON.stringify({ helperDrift, externalDrift: b1Drift, before: s1?.cursorBefore, after: s1?.cursorAfter }))
  } else if (b1Drift <= 5) {
    record('B1 不移动光标', 'PASS', JSON.stringify({ p: p?.cursor, p2: p2?.cursor, drift: b1Drift }))
  } else {
    record('B1 不移动光标', 'BLOCKED', `脏桌面光标漂移 ${b1Drift}px；helper 报告 cursorMoved=false，无法归因`)
  }
  if (s1?.side_effects?.foregroundChanged === true) record('B1 不改变前台', 'FAIL', JSON.stringify(s1.side_effects))
  else if (p2 && p2.foreground !== p.foreground) record('B1 不改变前台', 'BLOCKED', `helper 报告 foregroundChanged=false，但 probe 观测变化（脏桌面无法归因）：${p.foreground} -> ${p2.foreground}`)
  else record('B1 不改变前台', 'PASS', `foreground=${p.foreground}`)

  // B1 对只处理 WM_TOUCH 的目标：合成 pointer 是否被系统转换为 WM_TOUCH，只做事实记录。
  const t = await client.probe({ hwnd: state.touchOnly, pid: state.pid })
  if (!t || t.ok !== true) throw new Error(`probe touchOnly failed: ${JSON.stringify(t)}`)
  const tc = { x: t.clientOrigin.x + Math.floor(t.clientRect.width / 2), y: t.clientOrigin.y + Math.floor(t.clientRect.height / 2) }
  await waitQuiet(state.touchOnly, state.pid)
  writeFileSync(state.touchOnlyLog, '')
  const st = await client.syntheticClick({ hwnd: state.touchOnly, pid: state.pid, x: tc.x, y: tc.y })
  await sleep(350)
  const tlog = readLog(state.touchOnlyLog)
  if (st?.ok && /WMTOUCH/.test(tlog)) record('B1 WM_TOUCH-only 目标', 'PASS', JSON.stringify(st) + ' log=' + JSON.stringify(tlog.slice(-120)))
  else if (st?.code === 'desktop_busy') record('B1 WM_TOUCH-only 目标', 'BLOCKED', '静默预检失败：' + JSON.stringify(st))
  else if (st?.ok === false) record('B1 WM_TOUCH-only 目标', 'BLOCKED', 'helper 拒绝/不可用；未证明 WM_TOUCH 转换：' + JSON.stringify(st))
  else record('B1 WM_TOUCH-only 目标', 'BLOCKED', '合成 pointer 未转换为 WM_TOUCH；目标不支持 B1：' + JSON.stringify({ st, log: tlog.slice(-120) }))

  // B1 对未注册触控的普通窗口：系统是否把合成 pointer 提升为鼠标消息。
  const mo = await client.probe({ hwnd: state.mouseOnly, pid: state.pid })
  if (!mo || mo.ok !== true) {
    record('B1 普通窗口鼠标提升', 'BLOCKED', `probe mouseOnly failed: ${JSON.stringify(mo)}`)
  } else {
    const mc = { x: mo.clientOrigin.x + Math.floor(mo.clientRect.width / 2), y: mo.clientOrigin.y + Math.floor(mo.clientRect.height / 2) }
    await waitQuiet(state.mouseOnly, state.pid)
    writeFileSync(state.mouseOnlyLog, '')
    const sm = await client.syntheticClick({ hwnd: state.mouseOnly, pid: state.pid, x: mc.x, y: mc.y, anchor: false })
    await sleep(350)
    const mlog = readLog(state.mouseOnlyLog)
    if (sm?.ok && /MOUSEDOWN/.test(mlog)) {
      record('B1 普通窗口鼠标提升', 'PASS', '无 anchor 单点合成触控被系统提升为鼠标消息；应用语义仍未验证：' + JSON.stringify(sm) + ' log=' + JSON.stringify(mlog.slice(-120)))
    } else if (sm?.code === 'desktop_busy') {
      record('B1 普通窗口鼠标提升', 'BLOCKED', '静默预检失败：' + JSON.stringify(sm))
    } else if (sm?.ok === false) {
      record('B1 普通窗口鼠标提升', 'BLOCKED', 'helper 拒绝：' + JSON.stringify(sm))
    } else {
      record('B1 普通窗口鼠标提升', 'BLOCKED', '未收到 MOUSEDOWN/MOUSEUP；普通窗口不外推：' + JSON.stringify({ sm, log: mlog.slice(-120) }))
    }
  }

  await waitQuiet(state.pointer, state.pid)
  writeFileSync(coverFile, '1')
  await sleep(500)
  const s2 = await client.syntheticClick({ hwnd: state.pointer, pid: state.pid, x: pc.x, y: pc.y })
  if (s2 && s2.ok === false && s2.code === 'occluded') record('B1 遮挡失败关闭', 'PASS', JSON.stringify(s2))
  else if (s2 && s2.code === 'desktop_busy') record('B1 遮挡失败关闭', 'BLOCKED', '静默预检失败：' + JSON.stringify(s2))
  else if (s2 && (s2.code === 'secure_desktop' || s2.code === 'uipi')) record('B1 遮挡失败关闭', 'BLOCKED', '输入桌面/完整性变化；失败关闭：' + JSON.stringify(s2))
  else record('B1 遮挡失败关闭', 'FAIL', JSON.stringify(s2))
  writeFileSync(coverFile, '0')
  await sleep(300)

  await waitQuiet(state.message, state.pid)
  writeFileSync(state.wndLog, '')
  const c = await client.cursorClick({ hwnd: state.message, pid: state.pid, x: btn.x, y: btn.y, anchor: 'block' })
  if (c?.ok === true) {
    await sleep(300)
    const clog = readLog(state.wndLog)
    record('B2 cursor anchored (BlockInput)', /MOUSEDOWN/.test(clog) && c.cursorRestored === true ? 'PASS' : 'FAIL', JSON.stringify(c) + ' log=' + JSON.stringify(clog.slice(-120)))
  } else if (c?.code === 'block_input_failed') {
    const diag = c.diagnostics || {}
    record('B2 cursor anchored (BlockInput)', 'BLOCKED',
      `BlockInput 被拒 win32=${c.win32Error ?? '?'} elevated=${diag.helperElevated} uiAccess=${diag.helperUIAccess} session=${diag.helperSessionId}/${diag.activeConsoleSessionId} desktop=${diag.inputDesktop || diag.threadDesktop || '?'}`)
    await waitQuiet(state.message, state.pid)
    writeFileSync(state.wndLog, '')
    const cc = await client.cursorClick({ hwnd: state.message, pid: state.pid, x: btn.x, y: btn.y, anchor: 'clip' })
    if (cc?.ok === true) {
      await sleep(300)
      const cliplog = readLog(state.wndLog)
      const clipOk = /MOUSEDOWN/.test(cliplog) && cc.clipRestored === true && cc.cursorRestored !== false
      record('B2 cursor-clip anchored', clipOk ? 'PASS' : 'FAIL', JSON.stringify(cc) + ' log=' + JSON.stringify(cliplog.slice(-120)))
    } else if (cc?.code === 'desktop_busy' || cc?.code === 'clip_anchor_failed' || cc?.code === 'secure_desktop' || cc?.code === 'uipi' || cc?.code === 'clip_cursor') {
      record('B2 cursor-clip anchored', 'BLOCKED', 'ClipCursor 替代锚定失败关闭；未冒充 PASS：' + JSON.stringify(cc))
    } else {
      record('B2 cursor-clip anchored', 'FAIL', JSON.stringify(cc))
    }
  } else if (c?.code === 'desktop_busy') {
    record('B2 cursor anchored (BlockInput)', 'BLOCKED', '静默预检失败（桌面光标仍在移动）：' + JSON.stringify(c))
  } else if (c?.code === 'secure_desktop' || c?.code === 'uipi') {
    record('B2 cursor anchored (BlockInput)', 'BLOCKED', '输入桌面/完整性变化；失败关闭：' + JSON.stringify(c))
  } else {
    record('B2 cursor anchored (BlockInput)', 'FAIL', JSON.stringify(c))
  }

  await waitQuiet(state.message, state.pid)
  const before = await client.probe({ hwnd: state.message, pid: state.pid })
  writeFileSync(state.wndLog, '')
  const w = await client.windowClick({ hwnd: state.message, pid: state.pid, clientX: 50, clientY: 50 })
  await sleep(350)
  const after = await client.probe({ hwnd: state.message, pid: state.pid })
  const restored = before && after && before.windowRect.left === after.windowRect.left && before.windowRect.top === after.windowRect.top
  if (w?.ok === true && w.windowRestored === true && restored && /MOUSEDOWN/.test(readLog(state.wndLog))) {
    record('B3 window anchored', 'PASS', JSON.stringify(w))
  } else if (w?.ok === true && w?.warning_code === 'window_changed_externally') {
    record('B3 window anchored', 'BLOCKED', '点击后窗口被外部移动；未抢回，不冒充 PASS：' + JSON.stringify(w))
  } else if (['window_move_failed', 'cursor_changed', 'secure_desktop', 'uipi', 'desktop_busy', 'window_changed_externally', 'window_not_movable', 'clip_cursor'].includes(w?.code)) {
    record('B3 window anchored', 'BLOCKED', '脏桌面/输入桌面变化导致失败关闭；未发送点击，不冒充 PASS：' + JSON.stringify(w))
  } else {
    record('B3 window anchored', 'FAIL', JSON.stringify(w) + ' log=' + JSON.stringify(readLog(state.wndLog).slice(-120)))
  }
} catch (err) {
  if (!err?.blocked) record('探针异常', 'FAIL', String(err?.message || err).slice(0, 400))
} finally {
  try { if (client) await client.stop() } catch { /* ignore */ }
  if (app && state) await stopApp(app, state, tempDir).catch(() => undefined)
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

console.log(`\n${results.filter((x) => x.status === 'PASS').length} PASS / ${blocked} BLOCKED / ${failed} FAIL`)
console.log(`JSON ${JSON.stringify({ title: 'background-input', results })}`)
process.exit(failed > 0 ? 1 : 0)
