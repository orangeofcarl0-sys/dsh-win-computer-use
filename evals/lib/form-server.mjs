/**
 * form-server.mjs -- local-only HTTP fixture for S4 browser-form tasks.
 *
 * Usage:
 *   node evals/lib/form-server.mjs --root <dir> --result <json> --state <json> [--port 0]
 *
 * Writes a local state file with pid/port/startedAt. The visible browser uses
 * 127.0.0.1 only; no external network and no user cookies/profile changes.
 * The server is test-owned: cleanup may stop it by PID after verifying StartTime.
 */
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'

const args = process.argv.slice(2)
const val = (name, dflt = '') => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt
}
const root = resolve(val('root', '.'))
const resultPath = resolve(val('result', join(root, 'result.json')))
const statePath = resolve(val('state', join(root, 'server.json')))
const port = Math.max(0, Number(val('port', '0')) || 0)

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-T16-FORM</title>
<style>
body{font:16px/1.5 Segoe UI,Arial;margin:40px;max-width:720px}
label{display:block;margin:12px 0 4px;font-weight:600}
input[type=text],input[type=email],select,textarea{width:100%;padding:8px;font:inherit}
.row{margin:10px 0}.hint{color:#555;font-size:13px}
button{margin-top:18px;padding:10px 18px;font:inherit}
</style></head><body>
<h1>S4 T16 Form</h1>
<p class="hint">Local fixture. Fill the requested values and press Submit.</p>
<form method="post" action="/submit">
  <label for="name">Full name</label>
  <input id="name" name="name" type="text" autocomplete="off">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="off">
  <label for="plan">Plan</label>
  <select id="plan" name="plan"><option>Basic</option><option>Pro</option><option>Enterprise</option></select>
  <div class="row"><label>Contact</label>
    <label><input type="radio" name="contact" value="Email"> Email</label>
    <label><input type="radio" name="contact" value="Phone"> Phone</label>
  </div>
  <div class="row"><label><input type="checkbox" name="newsletter" value="yes"> Newsletter</label></div>
  <label for="notes">Notes</label>
  <textarea id="notes" name="notes" rows="4"></textarea>
  <button type="submit">Submit</button>
</form></body></html>`

function send(res, code, body, type = 'text/html; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function parseBody(req) {
  return new Promise((resolveBody, reject) => {
    let buf = ''
    req.on('data', (d) => { buf += d; if (buf.length > 1e6) reject(new Error('body too large')) })
    req.on('end', () => {
      const ct = String(req.headers['content-type'] || '')
      if (ct.includes('application/json')) {
        try { resolveBody(JSON.parse(buf || '{}')) } catch (e) { reject(e) }
        return
      }
      const out = {}
      for (const [k, v] of new URLSearchParams(buf)) out[k] = v
      resolveBody(out)
    })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/form.html')) {
      send(res, 200, PAGE)
      return
    }
    if (req.method === 'POST' && url.pathname === '/submit') {
      const body = await parseBody(req)
      const payload = {
        name: String(body.name || ''),
        email: String(body.email || ''),
        plan: String(body.plan || ''),
        contact: String(body.contact || ''),
        newsletter: String(body.newsletter || '') === 'yes',
        notes: String(body.notes || ''),
        at: new Date().toISOString(),
      }
      mkdirSync(dirname(resultPath), { recursive: true })
      writeFileSync(resultPath, JSON.stringify(payload, null, 2))
      send(res, 200, '<!doctype html><html><head><meta charset="utf-8"><title>S4-T16-FORM-OK</title></head><body><h1>Submitted</h1><p id="ok">S4-T16-FORM-OK</p></body></html>')
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/static/')) {
      const rel = normalize(url.pathname.slice('/static/'.length)).replace(/^(\.\.[/\\])+/, '')
      const p = join(root, rel)
      if (!p.startsWith(root)) { send(res, 403, 'forbidden', 'text/plain'); return }
      try {
        const data = readFileSync(p)
        send(res, 200, data, p.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream')
      } catch { send(res, 404, 'not found', 'text/plain') }
      return
    }
    send(res, 404, 'not found', 'text/plain')
  } catch (e) {
    send(res, 500, 'server error: ' + String(e.message || e), 'text/plain')
  }
})

server.listen(port, '127.0.0.1', () => {
  const actual = server.address().port
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify({
    ok: true,
    pid: process.pid,
    port: actual,
    startedAt: new Date().toISOString(),
    root,
    result: resultPath,
  }, null, 2))
  console.log(`S4 form server listening on http://127.0.0.1:${actual}/form.html`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { server.close() } catch {} ; process.exit(0) })
}
