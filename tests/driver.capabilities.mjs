/**
 * driver.capabilities.mjs —— 版本解析、能力预设、请求映射与自适应学习。
 * 不 spawn 真实驱动：fake transport 的 runOnce 返回固定文本。
 */
import assert from 'node:assert/strict'
import {
  compareVersions, parseVersionText, parseContractText, baseCapabilities,
  capabilitiesFor, mapRequest, learnFromResponse, learnFromError,
  detectCapabilities, capabilitySummary,
} from '../lib/driver/capabilities.js'

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

check('C1 版本解析：cua-driver 0.23.2 / v0.53.0 / 预发布', () => {
  assert.equal(parseVersionText('cua-driver 0.23.2'), '0.23.2')
  assert.equal(parseVersionText('cua-driver-rs v0.53.0'), '0.53.0')
  assert.equal(parseVersionText('cua-driver 0.52.13-beta.1'), '0.52.13')
  assert.equal(parseVersionText('no version here'), null)
})

check('C2 semver 比较', () => {
  assert.equal(compareVersions('0.23.2', '0.39.0'), -1)
  assert.equal(compareVersions('0.39.0', '0.39.0'), 0)
  assert.equal(compareVersions('0.53.0', '0.52.13'), 1)
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1)
})

check('C3 0.23.2 → legacy，tree_format 可用但原生 drag 不可用', () => {
  const c = capabilitiesFor({ version: '0.23.2' })
  assert.equal(c.profile, 'legacy')
  assert.equal(c.treeFormat, true)
  assert.equal(c.dragModifier, false)
  assert.equal(c.pointerCapture, false)
  assert.equal(c.flatWindow, false)
  assert.equal(c.screenshotFrame, false)
})

check('C4 0.39.0 → modern，原生 drag modifier', () => {
  const c = capabilitiesFor({ version: '0.39.0' })
  assert.equal(c.profile, 'modern')
  assert.equal(c.dragModifier, true)
  assert.equal(c.pointerCapture, false)
  assert.equal(c.flatWindow, false)
})

check('C4b 0.52.13 → 像素动作需要截图上下文', () => {
  const c = capabilitiesFor({ version: '0.52.13' })
  assert.equal(c.pointerCapture, true)
  assert.equal(c.profile, 'modern')
})

check('C5 0.53.0 → latest，flat window + screenshot_frame', () => {
  const c = capabilitiesFor({ version: '0.53.0' })
  assert.equal(c.profile, 'latest')
  assert.equal(c.dragModifier, true)
  assert.equal(c.flatWindow, true)
  assert.equal(c.screenshotFrame, true)
})

check('C6 显式 legacy 覆盖新版本能力', () => {
  const c = capabilitiesFor({ version: '0.53.0', profile: 'legacy' })
  assert.equal(c.profile, 'legacy')
  assert.equal(c.dragModifier, false)
  assert.equal(c.flatWindow, false)
  assert.equal(c.screenshotFrame, false)
})

check('C7 显式 latest 覆盖旧版本能力', () => {
  const c = capabilitiesFor({ version: '0.23.2', profile: 'latest' })
  assert.equal(c.profile, 'latest')
  assert.equal(c.dragModifier, true)
  assert.equal(c.flatWindow, true)
})

check('C8 contract 文本：mismatch 与 status 两形态', () => {
  const m = parseContractText('contract version 0.7.0 does not match SDK 0.8.0')
  assert.deepEqual(m, { daemonContract: '0.7.0', sdkContract: '0.8.0' })
  const s = parseContractText('daemon running\ncontract: 0.8.0\nSDK: 0.8.0')
  assert.equal(s.daemonContract, '0.8.0')
  assert.equal(s.sdkContract, '0.8.0')
  assert.equal(parseContractText('nothing'), null)
})

check('C9 响应学习：0.23.2 形态 → frameSpace=screen，无需 tree_format 重试', () => {
  const c = baseCapabilities()
  const legacy = {
    elements: [{ element_index: 0, frame: { x: 10, y: 20, w: 30, h: 40 } }],
    tree_markdown: '[0] Button',
  }
  const r = learnFromResponse(c, 'get_window_state', legacy)
  assert.equal(c.frameSpace, 'screen')
  assert.equal(r.retryTreeFormat, false)
})

check('C10 空 elements + markdown → 建议补 tree_format 重试', () => {
  const c = baseCapabilities()
  const r = learnFromResponse(c, 'get_window_state', { elements: [], tree_markdown: '# tree' })
  assert.equal(r.retryTreeFormat, true)
})

check('C11 响应学习：window_bounds / screenshot_frame 标志', () => {
  const c = baseCapabilities()
  learnFromResponse(c, 'get_window_state', {
    window_bounds: { x: 100, y: 100, width: 800, height: 600 },
    elements: [{ frame: { x: 120, y: 130, w: 10, h: 10 }, screenshot_frame: { x: 20, y: 30, w: 10, h: 10 } }],
  })
  assert.equal(c.flatWindow, true)
  assert.equal(c.screenshotFrame, true)
  assert.equal(c.frameSpace, 'screen')
})

check('C12 错误学习：tree_format 无效 → 关闭并记录', () => {
  const c = baseCapabilities()
  const changed = learnFromError(c, 'get_window_state', new Error('invalid_arguments: unknown field tree_format'))
  assert.equal(changed, true)
  assert.equal(c.treeFormat, false)
  assert.ok(c.learned.length > 0)
})

check('C13 错误学习：drag modifier 不支持 → 关闭原生 drag', () => {
  const c = capabilitiesFor({ version: '0.39.0' })
  const changed = learnFromError(c, 'drag', new Error('modifier is not supported for background drag'))
  assert.equal(changed, true)
  assert.equal(c.dragModifier, false)
})

check('C14 错误学习：无关错误不改变能力', () => {
  const c = baseCapabilities()
  const changed = learnFromError(c, 'click', new Error('timeout after 30000ms'))
  assert.equal(changed, false)
  assert.equal(c.treeFormat, true)
})

const fakeTransport = (versionText, statusText = '') => ({
  bin: 'fake-cua',
  async runOnce(argv) {
    if (argv[0] === '--version') return { code: 0, stdout: versionText, stderr: '' }
    if (argv[0] === 'status') return { code: 0, stdout: statusText, stderr: '' }
    return { code: 1, stdout: '', stderr: 'unknown' }
  },
})

const main = async () => {
  const c = await detectCapabilities({
    transport: fakeTransport('cua-driver 0.53.0\n', 'contract: 0.8.0\nSDK: 0.8.0'),
  })
  check('C15b detectCapabilities：--version/status 探测', () => {
    assert.equal(c.version, '0.53.0')
    assert.equal(c.profile, 'latest')
    assert.equal(c.contract.daemonContract, '0.8.0')
  })

  const u = await detectCapabilities({
    transport: { bin: 'fake', rawCall: async () => ({}) },
    env: {},
  })
  check('C16b runOnce 缺失时退 unknown 而不抛错', () => {
    assert.equal(u.version, null)
    assert.equal(u.profile, 'unknown')
    assert.equal(u.dragModifier, false)
  })

  const e = await detectCapabilities({
    transport: fakeTransport('cua-driver 0.23.2\n'),
    env: { CUA_DRIVER_VERSION: '0.39.0' },
  })
  check('C17 env 版本覆盖优先', () => {
    assert.equal(e.version, '0.39.0')
    assert.equal(e.dragModifier, true)
  })

  const mismatch = await detectCapabilities({
    transport: fakeTransport('cua-driver 0.53.0\n', 'contract version 0.7.0 does not match SDK 0.8.0'),
  })
  check('C18 contract mismatch 进入 warnings', () => {
    assert.ok(mismatch.warnings.some((w) => /contract 不一致/.test(w)))
  })

  check('C19 capabilitySummary 带 contract', () => {
    const s = capabilitySummary({
      version: '0.53.0', profile: 'latest', treeFormat: true, dragModifier: true,
      contract: { daemonContract: '0.8.0' },
    })
    assert.match(s, /contract=0\.8\.0/)
  })

  console.log(`\n结果：${failures ? `❌ ${failures} 项失败` : '✅ 全部通过'}`)
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
