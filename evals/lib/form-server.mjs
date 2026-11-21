/**
 * form-server.mjs -- local-only HTTP fixture for eval browser tasks.
 *
 * Usage:
 *   node evals/lib/form-server.mjs --root <dir> --result <json> --state <json> [--port 0]
 *     [--mode form|pixel1|pixel2|pixel3|download|download-csv|download-flaky] [--fixture <file>] [--fail-first]
 *
 * Writes a local state file with pid/port/mode/startedAt. The visible browser uses
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
const mode = val('mode', 'form')
const fixture = resolve(val('fixture', join(root, 'download.pdf')))
const failFirst = args.includes('--fail-first')
let downloadAttempts = 0

const PAGE_FORM = `<!doctype html>
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

const PAGE_PIXEL1 = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-P01-PIXEL</title>
<style>html,body{margin:0;background:#fff}canvas{display:block}</style></head>
<body><canvas id="c" width="640" height="400" aria-label="pixel grid"></canvas>
<script>
const c=document.getElementById('c'),g=c.getContext('2d');
const cols=6,rows=4,cw=90,ch=80,gap=10,ox=30,oy=30;
const colors=['#2f6fdb','#2f9e44','#f59f00','#ae3ec9','#0c8599'];
for(let r=0;r<rows;r++){for(let col=0;col<cols;col++){
  const x=ox+col*(cw+gap),y=oy+r*(ch+gap);
  g.fillStyle=colors[(r*cols+col)%colors.length];g.fillRect(x,y,cw,ch);
  if(col===2&&r===1){g.beginPath();g.arc(x+cw/2,y+ch/2,26,0,Math.PI*2);g.fillStyle='#e03131';g.fill();}
}}
c.addEventListener('click',async(ev)=>{
  const b=c.getBoundingClientRect();
  const x=Math.round(ev.clientX-b.left),y=Math.round(ev.clientY-b.top);
  const col=Math.floor((x-ox)/(cw+gap)),r=Math.floor((y-oy)/(ch+gap));
  const cell=(col>=0&&col<cols&&r>=0&&r<rows)?String.fromCharCode(65+col)+(r+1):'';
  await fetch('/hit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x,y,cell})});
  document.body.innerHTML='<h1 id="ok">clicked</h1>';
});
</script></body></html>`

const PAGE_PIXEL2 = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-P02-TOKEN</title>
<style>body{font:16px Segoe UI,Arial;margin:30px}canvas{display:block;border:1px solid #ccc}input{font:18px monospace;padding:8px;width:240px;margin-top:18px}button{margin-left:8px;padding:8px 16px}</style></head>
<body><canvas id="c" width="420" height="160" aria-hidden="true"></canvas>
<input id="t" aria-label="code"><button id="b">Submit</button>
<script>
const g=document.getElementById('c').getContext('2d');
g.fillStyle='#111';g.font='bold 48px Consolas,monospace';g.fillText('P02-7K9',30,100);
document.getElementById('b').addEventListener('click',async()=>{
  const token=document.getElementById('t').value;
  await fetch('/submit-token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
  document.body.innerHTML='<h1 id="ok">submitted</h1>';
});
</script></body></html>`

const PAGE_PIXEL3 = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-P03-ZOOM</title>
<style>html,body{margin:0;background:#fff}canvas{display:block}</style></head>
<body><canvas id="c" width="900" height="600" aria-label="dense grid"></canvas>
<script>
const c=document.getElementById('c'),g=c.getContext('2d');
const cols=12,rows=8,cw=60,ch=60,gap=6,ox=20,oy=20;
for(let r=0;r<rows;r++){for(let col=0;col<cols;col++){
  const x=ox+col*(cw+gap),y=oy+r*(ch+gap);
  g.fillStyle=((r+col)%2)?'#d0ebff':'#e7f5ff';g.fillRect(x,y,cw,ch);
  g.strokeStyle='#adb5bd';g.strokeRect(x,y,cw,ch);
  if(col===3&&r===2){g.fillStyle='#e03131';g.fillRect(x+cw/2-8,y+ch/2-8,16,16);}
}}
c.addEventListener('click',async(ev)=>{
  const b=c.getBoundingClientRect();
  const x=Math.round(ev.clientX-b.left),y=Math.round(ev.clientY-b.top);
  const col=Math.floor((x-ox)/(cw+gap)),r=Math.floor((y-oy)/(ch+gap));
  const cell=(col>=0&&col<cols&&r>=0&&r<rows)?String.fromCharCode(65+col)+(r+1):'';
  await fetch('/hit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({x,y,cell})});
  document.body.innerHTML='<h1 id="ok">clicked</h1>';
});
</script></body></html>`

const PAGE_DOWNLOAD = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-T18-DOWNLOAD</title>
<style>body{font:16px Segoe UI,Arial;margin:40px}code{background:#f1f3f5;padding:2px 6px}</style></head>
<body><h1>S4 T18 Download</h1>
<p>Download the PDF for this task.</p>
<p><a id="dl" href="/download/paper.pdf">Download PDF</a></p>
<p class="hint">The file is served locally from 127.0.0.1.</p>
</body></html>`

const PAGE_DOWNLOAD_CSV = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-COMBO02-DOWNLOAD</title>
<style>body{font:16px Segoe UI,Arial;margin:40px}code{background:#f1f3f5;padding:2px 6px}</style></head>
<body><h1>S4 Combo02 Download</h1>
<p>Download the sales CSV for this task.</p>
<p><a id="dl" href="/download/sales.csv">Download CSV</a></p>
<p class="hint">The file is served locally from 127.0.0.1.</p>
</body></html>`

const PAGE_DOWNLOAD_FLAKY = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-REC03-FLAKY</title>
<style>body{font:16px Segoe UI,Arial;margin:40px}code{background:#f1f3f5;padding:2px 6px}</style></head>
<body><h1>S4 Rec03 Flaky Download</h1>
<p>The first download request may fail. Retry until the PDF is saved.</p>
<p><a id="dl" href="/download/paper.pdf">Download PDF</a></p>
<p class="hint">The file is served locally from 127.0.0.1.</p>
</body></html>`

const PAGE_TABS = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-B01-TABS</title>
<style>body{font:16px Segoe UI,Arial;margin:40px}a{display:block;margin:12px 0}</style></head>
<body><h1>S4 B01 Tabs</h1>
<p>Open both links in separate tabs.</p>
<a id="a" href="/tabs/a" target="_blank">Tab A</a>
<a id="b" href="/tabs/b" target="_blank">Tab B</a>
</body></html>`

const PAGE_TAB_A = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-B01-A</title></head>
<body><h1>S4 B01 A</h1><p id="marker">S4 B01 A READY</p></body></html>`

const PAGE_TAB_B = `<!doctype html>
<html><head><meta charset="utf-8"><title>S4-B01-B</title>
<style>body{font:16px Segoe UI,Arial;margin:40px}label{display:block;margin:10px 0 4px}input,textarea{width:320px;padding:6px;font:inherit}</style></head>
<body><h1>S4 B01 B</h1>
<form method="post" action="/submit">
  <label for="name">Name</label><input id="name" name="name" type="text">
  <label for="notes">Notes</label><textarea id="notes" name="notes"></textarea>
  <button type="submit">Submit</button>
</form></body></html>`

const PAGES = {
  form: PAGE_FORM,
  pixel1: PAGE_PIXEL1,
  pixel2: PAGE_PIXEL2,
  pixel3: PAGE_PIXEL3,
  download: PAGE_DOWNLOAD,
  'download-csv': PAGE_DOWNLOAD_CSV,
  'download-flaky': PAGE_DOWNLOAD_FLAKY,
  tabs: PAGE_TABS,
}

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

function writeResult(payload) {
  mkdirSync(dirname(resultPath), { recursive: true })
  writeFileSync(resultPath, JSON.stringify(payload, null, 2))
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/form.html')) {
      send(res, 200, PAGES[mode] || PAGE_FORM)
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
      writeResult(payload)
      send(res, 200, '<!doctype html><html><head><meta charset="utf-8"><title>S4-T16-FORM-OK</title></head><body><h1>Submitted</h1><p id="ok">S4-T16-FORM-OK</p></body></html>')
      return
    }
    if (req.method === 'POST' && (url.pathname === '/hit' || url.pathname === '/submit-token')) {
      const body = await parseBody(req)
      const payload = url.pathname === '/submit-token'
        ? { token: String(body.token || ''), expected: 'P02-7K9', ok: String(body.token || '') === 'P02-7K9', at: new Date().toISOString() }
        : { x: Number(body.x), y: Number(body.y), cell: String(body.cell || ''), target: mode === 'pixel1' ? 'C2' : 'D3', hit: String(body.cell || '') === (mode === 'pixel1' ? 'C2' : 'D3'), at: new Date().toISOString() }
      writeResult(payload)
      send(res, 200, '<!doctype html><html><head><meta charset="utf-8"><title>ok</title></head><body>ok</body></html>')
      return
    }
    if (req.method === 'GET' && url.pathname === '/download/sales.csv') {
      try {
        const data = readFileSync(fixture)
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="s4-combo02-sales.csv"',
          'content-length': data.length,
          'cache-control': 'no-store',
        })
        res.end(data)
      } catch { send(res, 404, 'fixture not found', 'text/plain') }
      return
    }
    if (req.method === 'GET' && url.pathname === '/download/paper.pdf') {
      downloadAttempts++
      if (failFirst && downloadAttempts === 1) {
        send(res, 500, 'temporary failure; retry the download', 'text/plain')
        return
      }
      try {
        const data = readFileSync(fixture)
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="s4-t18-paper.pdf"',
          'content-length': data.length,
          'cache-control': 'no-store',
        })
        res.end(data)
      } catch { send(res, 404, 'fixture not found', 'text/plain') }
      return
    }
    if (req.method === 'GET' && url.pathname === '/tabs/a') {
      send(res, 200, PAGE_TAB_A)
      return
    }
    if (req.method === 'GET' && url.pathname === '/tabs/b') {
      send(res, 200, PAGE_TAB_B)
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
    mode,
    fixture,
    startedAt: new Date().toISOString(),
    root,
    result: resultPath,
  }, null, 2))
  console.log(`eval ${mode} server listening on http://127.0.0.1:${actual}/`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { server.close() } catch {} ; process.exit(0) })
}
