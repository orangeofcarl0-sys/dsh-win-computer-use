/**
 * eval 轨迹离线分析：从 ~/.dsh/sessions 的 zstd 会话文件提取每条任务的执行画像。
 * 只读。用法：node evals/analyze-sessions.mjs [markerRegex...]
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import * as zlib from 'node:zlib'

const sessionsRoot = join(homedir(), '.dsh', 'sessions')
const wsArg = process.env.S4_WS || ''
const base = wsArg
  ? (wsArg.includes('\\') || wsArg.includes('/') ? wsArg : join(sessionsRoot, wsArg))
  : join(sessionsRoot, '--F-Codex_Work_Space-DSH~0020plugin-dsh-computer-use--')
const markers = process.argv.slice(2)

const ZSTD_MAGIC = 4247762216
/** 多 frame zstd 解码：session.v4 是 frame 拼接，one-shot 只会解第一帧。 */
function zstdFrames(raw) {
  const frames = []
  let off = 0
  while (off < raw.length) {
    const start = off
    if (raw.length - off < 4) break
    if (raw.readUInt32LE(off) !== ZSTD_MAGIC) throw new Error(`bad zstd magic @${off}`)
    off += 4
    if (off >= raw.length) break
    const d = raw.readUInt8(off++)
    if ((d & 24) !== 0) throw new Error('reserved frame header bit')
    const fcs = d >>> 6
    const single = (d & 32) !== 0
    const checksum = (d & 4) !== 0
    const dict = d & 3
    const dictBytes = dict === 3 ? 4 : dict
    const fcsBytes = fcs === 0 ? (single ? 1 : 0) : 1 << fcs
    const remain = (single ? 0 : 1) + dictBytes + fcsBytes
    if (raw.length - off < remain) break
    off += remain
    let torn = false
    for (;;) {
      if (raw.length - off < 3) { torn = true; break }
      const h = raw.readUIntLE(off, 3)
      off += 3
      const last = (h & 1) !== 0
      const type = (h >>> 1) & 3
      const size = h >>> 3
      if (type === 3) throw new Error('reserved block type')
      const payload = type === 1 ? 1 : size
      if (raw.length - off < payload) { torn = true; break }
      off += payload
      if (last) break
    }
    if (torn) break
    if (checksum) {
      if (raw.length - off < 4) break
      off += 4
    }
    frames.push(raw.subarray(start, off))
  }
  return frames
}

function decompressFile(f) {
  const raw = readFileSync(f)
  try {
    const frames = zstdFrames(raw)
    if (frames.length) return Buffer.concat(frames.map((fr) => zlib.zstdDecompressSync(fr)))
  } catch {}
  try {
    const out = zlib.zstdDecompressSync(raw)
    if (out.length > 1000) return out
  } catch {}
  // fallback: zstd CLI (handles multi-frame files)
  const tmp = f + '.dec.tmp'
  try {
    execFileSync('zstd', ['-d', '-f', '-o', tmp, f], { stdio: 'ignore' })
    const out = readFileSync(tmp)
    try { execFileSync('cmd', ['/c', 'del', '/q', tmp], { stdio: 'ignore' }) } catch {}
    return out
  } catch {
    try { execFileSync('cmd', ['/c', 'del', '/q', tmp], { stdio: 'ignore' }) } catch {}
    return null
  }
}

const dirs = readdirSync(base)
  .map((s) => join(base, s))
  .filter((d) => statSync(d).isDirectory())

const files = []
for (const d of dirs) {
  const candidates = [
    join(d, 'session.v4.jsonl.zstd'),
    join(d, 'session.v3.jsonl.zstd'),
    join(d, 'session.jsonl.zstd'),
  ]
  const f = candidates.find((p) => existsSync(p))
  if (!f) continue
  files.push({ f, mt: statSync(f).mtimeMs })
}
files.sort((a, b) => a.mt - b.mt)

for (const { f, mt } of files) {
  const buf = decompressFile(f)
  if (!buf) { console.log('skip (undecompressable):', f.match(/session-[0-9a-f-]{18}/)?.[0]); continue }
  const s = buf.toString('utf8')
  if (markers.length && !markers.some((m) => s.includes(m))) continue
  const lines = s.split('\n').filter((l) => l.trim().startsWith('{'))
  let title = ''
  const toolCounts = new Map()
  let lastAssistant = ''
  let errors = 0
  let guardRejects = 0
  let approveAsks = 0
  let observes = 0
  for (const l of lines) {
    let j
    try { j = JSON.parse(l) } catch { continue }
    const txt = JSON.stringify(j)
    // v4: tool/call 的 data.name；隐藏工具在 computer_do 的 arguments.tool 里。
    if (j.type === 'tool/call') {
      const d = j.data || {}
      let name = d.name || ''
      if (name === 'computer_do') {
        try {
          const a = JSON.parse(d.arguments || '{}')
          if (a.action === 'call' && a.tool) name = a.tool
        } catch {}
      }
      if (name) toolCounts.set(name, (toolCounts.get(name) || 0) + 1)
      if (name === 'screen_observe') observes++
    }
    if (j.type === 'tool/result') {
      const msg = j.data?.message || {}
      const c = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      if (/快照|snapshot_expired|无快照/.test(c) && /拒绝/.test(c)) guardRejects++
      if (/\[object Object\]|Error:|失败/.test(c) && c.length < 3000) errors++
      if (msg.isError) errors++
    }
    if (/等待审批|"approval"/.test(txt)) approveAsks++
    if (j.type === 'assistant/message') {
      const c = j.data?.message?.content || []
      const text = Array.isArray(c)
        ? c.filter((b) => b.type === 'text').map((b) => b.text).join('')
        : String(c || '')
      if (text.trim()) lastAssistant = text
    }
    if (!title && /"title"/.test(txt)) { try { title = j.data?.title || j.title || '' } catch {} }
  }
  console.log('────────────────────────────────────────')
  console.log('session:', f.match(/session-[0-9a-f-]+/)?.[0], '| mtime:', new Date(mt).toISOString().slice(5, 16), '| size:', Math.round(buf.length / 1000) + 'KB')
  if (markers.length) console.log('markers hit')
  console.log('tools:', [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' ') || '(none)')
  console.log('observe-ish:', observes, '| error-ish lines:', errors, '| guard-rejects:', guardRejects, '| approval-mentions:', approveAsks)
  if (lastAssistant) console.log('last assistant:', lastAssistant.replace(/\s+/g, ' ').slice(0, 400))
}
