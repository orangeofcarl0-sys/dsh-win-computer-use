/**
 * driver.normalize.mjs —— 响应归一化 fixtures（0.23.2 与 0.53 同族形态）。
 *
 * 目标：同一窗口/元素在两种驱动形态下归一化后，窗口、编号、token、角色、
 * 计数、本地中心坐标一致；并覆盖 zoom MIME、clipboard、verify、permissions、
 * launch、回执 verified:false、MCP content[] 解包。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boundsOf, normalizeWindowState, normalizeWindowList, normalizeZoom,
  normalizeClipboard, normalizeVerify, normalizePermissions, normalizeLaunch,
  normalizeReceipt, normalizeElement, unwrapDriverPayload, normalizeResponse,
} from '../lib/driver/normalize.js'
import {
  baseCapabilities, learnFromResponse, mapRequest, capabilitySummary,
} from '../lib/driver/capabilities.js'

const root = dirname(fileURLToPath(import.meta.url))
const load = (name) => JSON.parse(readFileSync(join(root, 'fixtures', 'driver', name), 'utf8'))
const legacy = load('legacy.window.json')
const v053 = load('v053.window.json')
const windows = load('windows.json')
const shapes = load('shapes.json')

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (err) {
    failures++
    console.log(`❌ ${name} — ${String(err.message).slice(0, 200)}`)
  }
}

const centerOfRect = (r) => ({
  x: Number(r.x) + Number(r.w ?? r.width) / 2,
  y: Number(r.y) + Number(r.h ?? r.height) / 2,
})
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol

check('N1 legacy 归一化保留编号/token/帧，并合成 window 对象', () => {
  const s = normalizeWindowState(legacy, baseCapabilities())
  assert.equal(s.elements.length, 3)
  assert.equal(s.elements[0].element_index, 0)
  assert.equal(s.elements[0].element_token, 'tok-0')
  assert.deepEqual(s.elements[0].frame, { x: 582, y: 527, w: 360, h: 135, width: 360, height: 135 })
  assert.ok(s.window && typeof s.window === 'object')
  assert.equal(s.window.title, '')
  assert.equal(s.element_count, 3)
  assert.equal(s.frame_space, 'screen')
})

check('N2 v053 归一化还原 window_title/window_bounds', () => {
  const s = normalizeWindowState(v053, baseCapabilities())
  assert.equal(s.window.title, 'S4 Shape')
  assert.equal(s.window.app_name, 'probe.exe')
  assert.equal(s.window.bounds.width, 1058)
  assert.equal(s.window.bounds.height, 799)
  assert.equal(s.window_bounds.x, 461)
  assert.equal(s.window_title, 'S4 Shape')
})

check('N3 v053 元素 frame 与 legacy 一致，screenshot_frame 保留', () => {
  const a = normalizeWindowState(legacy, baseCapabilities())
  const b = normalizeWindowState(v053, baseCapabilities())
  for (let i = 0; i < 3; i++) {
    assert.equal(b.elements[i].element_index, a.elements[i].element_index)
    assert.equal(b.elements[i].element_token, a.elements[i].element_token)
    assert.equal(b.elements[i].role, a.elements[i].role)
    assert.ok(near(b.elements[i].frame.x, a.elements[i].frame.x, 0.001))
    assert.ok(b.elements[i].screenshot_frame, `element ${i} missing screenshot_frame`)
  }
})

check('N4 legacy（中心-原点）与 v053 screenshot_frame 本地中心 ≤2px', () => {
  const a = normalizeWindowState(legacy, baseCapabilities())
  const b = normalizeWindowState(v053, baseCapabilities())
  const origin = { x: 461, y: 360 }
  for (let i = 0; i < 3; i++) {
    const ca = centerOfRect(a.elements[i].frame)
    const cb = centerOfRect(b.elements[i].screenshot_frame)
    assert.ok(Math.abs((ca.x - origin.x) - cb.x) <= 2, `x[${i}] ${ca.x - origin.x} vs ${cb.x}`)
    assert.ok(Math.abs((ca.y - origin.y) - cb.y) <= 2, `y[${i}] ${ca.y - origin.y} vs ${cb.y}`)
  }
})

check('N5 frame 与 screenshot_frame 同时存在 → 校准为 screen', () => {
  const caps = baseCapabilities()
  learnFromResponse(caps, 'get_window_state', v053)
  assert.equal(caps.frameSpace, 'screen')
  assert.equal(caps.flatWindow, true)
  assert.equal(caps.screenshotFrame, true)
})

check('N6 frame 也是截图空间 → 校准为 screenshot 并换算回屏幕坐标', () => {
  const raw = JSON.parse(JSON.stringify(v053))
  for (const e of raw.elements) e.frame = { ...e.screenshot_frame }
  const caps = baseCapabilities()
  learnFromResponse(caps, 'get_window_state', raw)
  assert.equal(caps.frameSpace, 'screenshot')
  const s = normalizeWindowState(raw, caps)
  const a = normalizeWindowState(legacy, baseCapabilities())
  for (let i = 0; i < 3; i++) {
    assert.ok(near(s.elements[i].frame.x, a.elements[i].frame.x, 2),
      `x[${i}] ${s.elements[i].frame.x} vs ${a.elements[i].frame.x}`)
    assert.ok(near(s.elements[i].frame.y, a.elements[i].frame.y, 2),
      `y[${i}] ${s.elements[i].frame.y} vs ${a.elements[i].frame.y}`)
  }
})

check('N7 list_windows：bounds w/h、is_minimized、app_name 归一', () => {
  const l = normalizeWindowList(windows)
  assert.equal(l.windows.length, 2)
  assert.equal(l.windows[0].bounds.width, 1058)
  assert.equal(l.windows[1].bounds.width, 640)
  assert.equal(l.windows[1].minimized, true)
  assert.equal(l.windows[0].app_name, 'probe.exe')
  assert.equal(l.windows[0].z_index, 5)
  assert.ok(Array.isArray(l._legacy_windows))
})

check('N8 list_windows 裸数组也接受', () => {
  const l = normalizeWindowList([{ window_id: 1, pid: 2, x: 3, y: 4, width: 5, height: 6 }])
  assert.equal(l.windows[0].bounds.width, 5)
  assert.equal(l.windows[0].minimized, false)
})

check('N9 zoom：jpeg/png format → mime_type', () => {
  assert.equal(normalizeZoom(shapes.zoomJpeg).mime_type, 'image/jpeg')
  assert.equal(normalizeZoom(shapes.zoomPng).mime_type, 'image/png')
  assert.equal(normalizeZoom(shapes.zoomPng).width, 200)
})

check('N10 clipboard：plain_text → text', () => {
  assert.equal(normalizeClipboard(shapes.clipboard).text, 'hello')
})

check('N11 verify_state：satisfied:true → predicates', () => {
  const v = normalizeVerify(shapes.verifySatisfied)
  assert.equal(v.predicates[0].status, 'satisfied')
  assert.equal(v.status, 'satisfied')
  assert.equal(v.stable, true)
})

check('N12 permissions：postmessage/post_message 两套拼写', () => {
  const p = normalizePermissions(shapes.permissions)
  assert.equal(p.post_message, true)
  assert.equal(p.postmessage, true)
})

check('N13 launch_app：is_minimized 与 bounds w/h 归一', () => {
  const l = normalizeLaunch(shapes.launch)
  assert.equal(l.running, true)
  assert.equal(l.windows[0].minimized, false)
  assert.equal(l.windows[0].bounds.width, 30)
  assert.equal(l.windows[0].bounds.height, 40)
})

check('N14 回执 verified:false 且无 effect → unverifiable', () => {
  const r = normalizeReceipt(shapes.receipts.verifiedFalse)
  assert.equal(r.effect, 'unverifiable')
  assert.equal(r.delivery.mode, 'foreground')
})

check('N15 回执保留 previous_fg_hwnd/route 等未知字段', () => {
  const r = normalizeReceipt({ effect: 'confirmed', previous_fg_hwnd: 99, route: 'uia' })
  assert.equal(r.previous_fg_hwnd, 99)
  assert.equal(r.route, 'uia')
})

check('N16 MCP content[] 文本 JSON + 图片块解包', () => {
  const v = unwrapDriverPayload(shapes.mcpWindow)
  assert.equal(v.pid, 42)
  assert.equal(v.elements.length, 1)
  assert.equal(v.screenshot_png_b64, 'AA==')
  assert.equal(v.screenshot_mime_type, 'image/png')
  assert.equal(v.content, undefined)
})

check('N17 文本 JSON 字符串也解包；普通文本保持原样', () => {
  assert.equal(unwrapDriverPayload('{"ok":true}').ok, true)
  assert.equal(unwrapDriverPayload('not json'), 'not json')
})

check('N18 element frame 接受 width/height 命名', () => {
  const e = normalizeElement({ element_index: 1, frame: { x: 10, y: 20, width: 30, height: 40 } })
  assert.equal(e.frame.w, 30)
  assert.equal(e.frame.h, 40)
  assert.equal(e.frame.width, 30)
})

check('N19 element_count 缺失时用 elements.length', () => {
  const raw = { ...legacy }
  delete raw.element_count
  delete raw.total_element_count
  const s = normalizeWindowState(raw, baseCapabilities())
  assert.equal(s.element_count, 3)
  assert.equal(s.total_element_count, 3)
})

check('N20 normalizeResponse 按工具分派；未知工具原样返回', () => {
  const s = normalizeResponse('get_window_state', v053, baseCapabilities())
  assert.equal(s.window.title, 'S4 Shape')
  assert.deepEqual(normalizeResponse('unknown_tool', { a: 1 }), { a: 1 })
})

check('N21 mapRequest：默认加 tree_format，legacy profile 也不丢', () => {
  const caps = baseCapabilities()
  assert.equal(mapRequest('get_window_state', { pid: 1 }, caps).tree_format, 'elements')
  assert.equal(mapRequest('get_window_state', { tree_format: 'both' }, caps).tree_format, 'both')
  assert.equal(mapRequest('list_windows', {}, caps).tree_format, undefined)
  caps.treeFormat = false
  assert.equal(mapRequest('get_window_state', { pid: 1 }, caps).tree_format, undefined)
})

check('N22 boundsOf 统一 width/height 与 w/h', () => {
  const b = boundsOf({ x: 1, y: 2, w: 3, h: 4 })
  assert.deepEqual({ width: b.width, height: b.height }, { width: 3, height: 4 })
})

check('N23 capabilitySummary 可读', () => {
  const s = capabilitySummary({ version: '0.23.2', profile: 'legacy', treeFormat: true, dragModifier: false })
  assert.match(s, /0\.23\.2/)
  assert.match(s, /tree_format=on/)
  assert.match(s, /native-drag=off/)
})

console.log(`\n结果：${failures ? `❌ ${failures} 项失败` : '✅ 全部通过'}`)
process.exit(failures ? 1 : 0)
