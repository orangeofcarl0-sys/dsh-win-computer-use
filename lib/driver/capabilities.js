/**
 * driver/capabilities.js —— 驱动版本、能力标志与请求形态。
 *
 * 立场：**不把版本号当唯一真相**。版本用于选择保守的默认值；真正的字段支持
 * 由响应/错误自适应学习（见 learnFromResponse / learnFromError）。这样用户装
 * 0.23.2、0.39、0.52、0.53 或未记录的补丁版，都能工作或明确降级。
 *
 * 能力标志只影响“请求带什么”和“可选路径是否启用”；响应归一化永远同时接受
 * 新旧形态（见 normalize.js），所以标志判错不会直接造成静默错误。
 */

/** 语义化版本比较：忽略预发布后缀，只比 x.y.z。 */
export function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b || '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** 从 `cua-driver 0.53.0` / `cua-driver-rs v0.53.0` 等文本里取第一个 x.y.z。 */
export function parseVersionText(text) {
  const m = String(text || '').match(/(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?\b/)
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null
}

/**
 * 从 `contract version 0.7.0 does not match SDK 0.8.0` 或 status 文本里取契约。
 * @returns {{daemonContract:string,sdkContract:string}|null}
 */
export function parseContractText(text) {
  const s = String(text || '')
  const mismatch = s.match(/contract version\s+([0-9][0-9.]*)\s+does not match SDK\s+([0-9][0-9.]*)/i)
  if (mismatch) return { daemonContract: mismatch[1], sdkContract: mismatch[2] }
  const c = s.match(/\bcontract(?:\s+version)?[:\s]+([0-9][0-9.]*)/i)
  const sdk = s.match(/\bSDK(?:\s+version)?[:\s]+([0-9][0-9.]*)/i)
  if (c || sdk) return { daemonContract: c ? c[1] : null, sdkContract: sdk ? sdk[1] : null }
  return null
}

/** 能力标志的默认值（未知版本时最保守：私有 drag、tree_format 先发后学）。 */
export function baseCapabilities() {
  return {
    version: null,
    profile: 'unknown',
    source: 'default',
    treeFormat: true,       // 发送 tree_format:"elements"；被拒后自适应关闭
    flatWindow: false,      // window_bounds/window_title（仅诊断/刷新增强）
    screenshotFrame: false, // 元素带 screenshot_frame
    frameSpace: null,       // 'screen' | 'screenshot' | null
    dragModifier: false,    // 原生 drag modifier；未知时用私有 helper
    pointerCapture: false,  // 像素动作是否需要先建立截图上下文（0.52+）
    moveCursorScreen: false, // move_cursor 的 window scope 是否要屏幕坐标（0.52+）
    zoomMime: true,         // zoom 返回 mime_type/format
    contract: null,
    warnings: [],
    learned: [],
  }
}

/**
 * 版本/显式 profile → 能力标志。
 * profile: auto | legacy | latest（显式 profile 优先于版本推断）。
 */
export function capabilitiesFor({ version = null, profile = 'auto', contract = null, source = 'version' } = {}) {
  const caps = baseCapabilities()
  caps.version = version
  caps.contract = contract
  caps.source = source

  if (version) {
    if (compareVersions(version, '0.39.0') >= 0) caps.dragModifier = true
    // 0.52+ 的像素 click/drag 要求同一窗口已有截图上下文：
    // 没有先 get_window_state(include_screenshot:true) 会得到
    // screenshot_context_missing / no_screenshot（2026-11-18 0.52.13 实测）。
    if (compareVersions(version, '0.52.0') >= 0) {
      caps.pointerCapture = true
      // 0.52 的 move_cursor window scope 文档是“screen coordinates of the
      // agent cursor overlay”；0.23.2 是窗口本地截图坐标。调用方按此换算。
      caps.moveCursorScreen = true
    }
    if (compareVersions(version, '0.53.0') >= 0) {
      caps.flatWindow = true
      caps.screenshotFrame = true
      caps.profile = 'latest'
    } else if (compareVersions(version, '0.39.0') >= 0) {
      caps.profile = 'modern'
    } else {
      caps.profile = 'legacy'
    }
  }

  if (profile === 'legacy') {
    caps.profile = 'legacy'
    caps.dragModifier = false
    caps.pointerCapture = false
    caps.moveCursorScreen = false
    caps.flatWindow = false
    caps.screenshotFrame = false
  } else if (profile === 'latest') {
    caps.profile = 'latest'
    caps.dragModifier = true
    caps.pointerCapture = true
    caps.moveCursorScreen = true
    caps.flatWindow = true
    caps.screenshotFrame = true
  }
  return caps
}

/** 请求形态映射：只在这里加版本相关字段，调用方参数保持原样。 */
export function mapRequest(tool, args = {}, caps, session = null) {
  const out = { ...args }
  if (tool === 'get_window_state') {
    if (caps?.treeFormat !== false && out.tree_format === undefined) {
      // 0.23.2 接受该字段；0.52+ 默认 markdown，必须显式要 elements。
      out.tree_format = 'elements'
    }
    // 0.52+ 的 element_token / zoom 截图上下文按 session 归属：
    // 观察不带 session 会建立“无会话快照”，随后带 session 的动作得到
    // stale_element_token（2026-11-18 0.52.13 实测）。0.23.2 也接受该字段。
    if (session && out.session === undefined) out.session = session
  }
  return out
}

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y)
  if (a.length === 0) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

/**
 * 用同时带 frame 与 screenshot_frame 的元素校准坐标空间。
 * - frame.x - screenshot_frame.x ≈ window_bounds.x → frame 是屏幕坐标；
 * - 差值 ≈ 0 → frame 也是截图坐标。
 * 窗口在 (0,0) 时两者等价，按 screenshot 记录，换算不会造成偏移。
 */
function calibrateFrameSpace(caps, state) {
  const bounds = state?.window_bounds || state?.window?.bounds || state?.bounds
  const els = Array.isArray(state?.elements) ? state.elements : []
  if (els.length === 0) return
  const pairs = els.filter((e) => e?.frame && e?.screenshot_frame)
  if (pairs.length > 0) {
    const dx = median(pairs.map((e) => Number(e.frame.x) - Number(e.screenshot_frame.x)))
    const dy = median(pairs.map((e) => Number(e.frame.y) - Number(e.screenshot_frame.y)))
    if (dx !== null && dy !== null) {
      const bx = Number(bounds?.x)
      const by = Number(bounds?.y)
      if (Number.isFinite(bx) && Number.isFinite(by)
        && Math.abs(dx - bx) <= 4 && Math.abs(dy - by) <= 4) {
        caps.frameSpace = 'screen'
      } else if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) {
        caps.frameSpace = 'screenshot'
      }
    }
    return
  }
  const hasShot = els.some((e) => e?.screenshot_frame)
  const hasFrame = els.some((e) => e?.frame)
  if (hasShot && !hasFrame) caps.frameSpace = 'screenshot'
  else if (hasFrame && !hasShot && caps.frameSpace === null) caps.frameSpace = 'screen'
}

/**
 * 归一化结果是否“树为空但仍有 markdown”：说明驱动可能默认 markdown，
 * 值得补一次 tree_format:"elements"。纯判断，不改能力标志。
 */
export function needsTreeFormatRetry(value) {
  if (!value || typeof value !== 'object') return false
  const els = Array.isArray(value.elements) ? value.elements : []
  const hasMarkdown = typeof value.tree_markdown === 'string' && value.tree_markdown.length > 0
  return els.length === 0 && hasMarkdown
}

/**
 * 从一次成功响应学习能力。
 * @returns {{retryTreeFormat:boolean}} retryTreeFormat=true 表示“树为空且驱动可能默认 markdown”，可补 tree_format 重试一次。
 */
export function learnFromResponse(caps, tool, value) {
  if (!caps || !value || typeof value !== 'object') return { retryTreeFormat: false }
  if (tool === 'get_window_state' || tool === 'get_desktop_state') {
    if (value.window_bounds !== undefined || value.window_title !== undefined) {
      caps.flatWindow = true
    }
    const els = Array.isArray(value.elements) ? value.elements : []
    if (els.some((e) => e?.screenshot_frame)) caps.screenshotFrame = true
    calibrateFrameSpace(caps, value)
    return { retryTreeFormat: needsTreeFormatRetry(value) }
  }
  return { retryTreeFormat: false }
}

/**
 * 从一次失败学习能力（只认明确提到字段的错误，避免把普通失败误判成能力缺失）。
 * @returns {boolean} 是否更新了能力
 */
export function learnFromError(caps, tool, err) {
  if (!caps) return false
  const msg = String(err?.message || err || '')
  let changed = false
  if (/tree_format/i.test(msg)
    && /(invalid|unknown|unexpected|not supported|unsupported|unrecognized|额外|未知)/i.test(msg)) {
    caps.treeFormat = false
    changed = true
  }
  if (tool === 'drag' && /modifier/i.test(msg)
    && /(invalid|unknown|unexpected|not supported|unsupported|unrecognized)/i.test(msg)) {
    caps.dragModifier = false
    changed = true
  }
  if (err?.contract && !caps.contract) {
    caps.contract = err.contract
    changed = true
  }
  if (changed) caps.learned.push(`${tool}: ${msg.slice(0, 120)}`)
  return changed
}

/**
 * 真机能力探测：`--version` + `status`。失败不阻塞（unknown 自适应）。
 * @param {{transport:object, profile?:string, env?:object}} opts
 */
export async function detectCapabilities({ transport, profile = 'auto', env = process.env } = {}) {
  const envProfile = String(env.CUA_DRIVER_PROFILE || '').trim()
  const effectiveProfile = profile && profile !== 'auto' ? profile : (envProfile || 'auto')
  let version = parseVersionText(env.CUA_DRIVER_VERSION || '')
  let contract = null
  const warnings = []
  let source = 'env'
  const canRun = typeof transport?.runOnce === 'function'

  if (!version && canRun) {
    try {
      const v = await transport.runOnce(['--version'], { timeoutMs: 5000 })
      version = parseVersionText(v.stdout) || parseVersionText(v.stderr)
      source = version ? 'version' : 'unavailable'
      if (!version && v.code !== 0) warnings.push(`--version 退出 ${v.code}`)
    } catch (err) {
      source = 'unavailable'
      warnings.push(`--version 探测失败：${String(err?.message || err).slice(0, 160)}`)
    }
  }

  if (canRun) {
    try {
      const st = await transport.runOnce(['status'], { timeoutMs: 5000 })
      contract = parseContractText(st.stdout) || parseContractText(st.stderr)
    } catch { /* status 不是所有版本都有；忽略 */ }
  }

  const caps = capabilitiesFor({ version, profile: effectiveProfile, contract, source })
  caps.warnings.push(...warnings)
  if (contract?.daemonContract && contract?.sdkContract
    && contract.daemonContract !== contract.sdkContract) {
    caps.warnings.push(`contract 不一致：daemon ${contract.daemonContract} / SDK ${contract.sdkContract}；CLI 与 daemon 必须一起升级`)
  }
  return caps
}

/** 一行能力摘要（status/诊断用）。 */
export function capabilitySummary(caps) {
  if (!caps) return '驱动能力未探测'
  const v = caps.version || '版本未知'
  const parts = [
    `${v} (${caps.profile})`,
    `tree_format=${caps.treeFormat === false ? 'off' : 'on'}`,
    `native-drag=${caps.dragModifier ? 'on' : 'off/private'}`,
    `pixel-capture=${caps.pointerCapture ? 'on' : 'off'}`,
  ]
  if (caps.contract?.daemonContract) parts.push(`contract=${caps.contract.daemonContract}`)
  return parts.join(' · ')
}
