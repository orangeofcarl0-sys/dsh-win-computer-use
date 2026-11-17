/**
 * observe.js —— screen_observe 工具实现（含原生视觉 Mode C / 观察者 Mode D）。
 *
 * 流程：list_windows 取窗口 → 选目标 → get_window_state 取 AX 树
 * → 精简为"编号 + 角色 + 标签 + 中心坐标"行 → 缓存快照。
 *
 * 坐标语义（cua-driver 0.21+ 实测）：所有动作坐标 = "窗口本地截图像素"，
 * 与 get_window_state 返回的截图 PNG 同一空间（左上原点）。因此：
 *   - 元素编号模式 → element_token（AX 路径，无需坐标）
 *   - x/y 坐标模式 → 直接透传截图像素，不做 ×2 / 窗口偏移换算
 *
 * 三种观察模式：
 *   - ax（默认）：只取 AX 树，零视觉 token 成本。
 *   - vision：DeepSeek 视觉观察者（ctx.llm → deepseek-flash，
 *     可配置 visionProvider/visionModel）结构化描述截图；模型不可用时回退 GLM。
 *   - native：截图经 attachments 持久化后以图片块("原生直读")返回 ——
 *     主对话模型（需支持 image 输入）直接看图，零外部 API。
 *   自动降级：AX 树为空（游戏/Canvas/Electron 不可解析）时，
 *   优先 native（route 支持 image）→ vision（有观察模型/GLM key）→ ax。
 */
import { withSession } from './cua.js'
import { cuaCall } from './cua.js'
import { createHash } from 'node:crypto'
import { clearSnapshot, getSnapshot, setSnapshot, isConsumed, isFresh, clearInputUnconfirmed } from './snapshot.js'
import { rememberWindows } from './windowMap.js'
import { saveImageAttachment } from './attach.js'
import { isActionableRole } from './roles.js'
import { menuStateOf } from './menu.js'
import { scanPasswords, markElementsFromScan, IS_WINDOWS } from './passwordScan.js'
import {
  deepseekVisionDescribe,
  glmVisionDescribe,
  glmVisionConfigured,
  routeImageCapable,
} from './vision.js'

/** AX role 中值得展示的精简角色名（太长会刷爆上下文）。键含 macOS AX 与 Windows UIA 两种命名。 */
const ROLE_SHORT = {
  AXWindow: '窗口',
  AXButton: '按钮',
  AXTextField: '输入框',
  AXTextArea: '文本框',
  AXCheckBox: '复选框',
  AXRadioButton: '单选',
  AXComboBox: '下拉框',
  AXMenuButton: '菜单按钮',
  AXMenuItem: '菜单项',
  AXLink: '链接',
  AXTab: '标签页',
  AXSlider: '滑块',
  AXScrollBar: '滚动条',
  AXTable: '表格',
  AXCell: '单元格',
  AXRow: '行',
  AXOutline: '大纲',
  AXList: '列表',
  AXStaticText: '文本',
  AXImage: '图片',
  AXPopUpButton: '弹出按钮',
  AXGroup: '分组',
  AXToolbar: '工具栏',
  AXSheet: '面板',
  AXDialog: '对话框',
  // Windows UIA 原生命名（dsv4fv 实验 GT 实证）
  Button: '按钮',
  Edit: '输入框',
  Document: '文档',
  ComboBox: '下拉框',
  CheckBox: '复选框',
  RadioButton: '单选',
  Hyperlink: '链接',
  TabItem: '标签页',
  MenuItem: '菜单项',
  Slider: '滑块',
  Spinner: '微调框',
  TreeItem: '树项',
  Tree: '树',
  ListItem: '列表项',
  List: '列表',
  SplitButton: '拆分按钮',
  ScrollBar: '滚动条',
  Header: '表头',
  StatusBar: '状态栏',
  TitleBar: '标题栏',
  AppBar: '应用栏',
  Group: '分组',
  Text: '文本',
}

function shortRole(role) {
  return ROLE_SHORT[role] || (role ? role.replace(/^AX/, '') : '元素')
}

/** 清洗为安全字符串：保证可无损 JSON 序列化（去孤立代理项）+ 截断。 */
function safeStr(v, max = 120) {
  let s = String(v ?? '')
  // 孤立代理项（Safari/网页 AX 值常见）会导致 JSON 序列化失败
  s = s.replace(/[\uD800-\uDFFF]/g, '\uFFFD')
  return s.slice(0, max)
}

/**
 * 窗口在屏幕上的物理像素原点（= list_windows 的 bounds）。
 * 实测依据（2026-09-16）：同一窗口 bounds 与 get_window_state 截图尺寸逐像素相同
 * （1906×1166 == 1906×1166），即截图是窗口 bounds 的 1:1 裁剪 → 原点可直接用 bounds.x/y。
 * 拿不到 bounds 时返回 null（模型应据此认定坐标换算不可用，而不是猜）。
 */
function screenOriginOf(target) {
  const b = target?.bounds
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') return null
  return { x: b.x, y: b.y, width: b.width ?? null, height: b.height ?? null }
}

/** 是否值得给编号（可交互或有关键文本）。角色判定跨平台（lib/roles.js）。 */
function isActionable(e) {
  if (isActionableRole(e.role || '')) return true
  if (e.label || e.value) return true
  return false
}

/**
 * 输入类角色：观察时显示“当前值”。
 * 2026-11-15 t01 实证：另存为对话框的 [77] 输入框只显示标签“文件名:”，
 * 模型看不到框里仍是 s4-t01-seed.txt，点保存触发覆盖确认后一路循环。
 * 密码类一律不显示值；Document/AXTextArea 不展示正文（需要读正文用 native/zoom）。
 */
const VALUE_ROLES = new Set([
  'Edit', 'ComboBox', 'Spinner', 'Slider',
  'AXTextField', 'AXComboBox', 'AXSlider',
])
const SECRET_ROLES = new Set(['AXSecureTextField', 'AXPasswordField', 'PasswordBox'])
const DOCUMENT_ROLES = /^(Document|AXTextArea|TextArea)$/i

/** Document/TextArea 角色判定（观察隐藏正文、type 回执提示共用）。 */
export function isDocumentRole(role) {
  return DOCUMENT_ROLES.test(String(role || ''))
}

/** Document/TextArea 的正文不进入 label 回退，避免 value 泄露到模型可见树。 */
function labelOfElement(e) {
  const raw = e?.label || (isDocumentRole(e?.role) ? '' : e?.value) || ''
  return String(raw)
}

/** 元素当前值（仅输入类、非密码；首行 + 48 字符上限）。 */
function displayValue(e) {
  if (!e || e.is_password) return ''
  if (SECRET_ROLES.has(String(e.role || ''))) return ''
  if (!VALUE_ROLES.has(String(e.role || ''))) return ''
  const v = String(e.value ?? '')
  if (!v) return ''
  return safeStr(v.split(String.fromCharCode(10))[0], 48)
}

/**
 * 元素中心坐标（driver 原始 frame = 屏幕物理像素）。
 * 注意：这不是 computer_click 的输入空间；mapElementsForModel() 会减窗口原点。
 * 非法/缺失时返回 null。
 */
function centerOf(e) {
  const f = e.frame
  if (!f) return null
  const x = f.x + f.w / 2
  const y = f.y + f.h / 2
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x), y: Math.round(y) }
}

/**
 * 渲染一行编号元素。
 * 坐标必须用 mapElementsForModel() 的窗口截图空间（= computer_click 输入空间）；
 * 没有映射时才退回 driver 原始 frame（无 bounds 的降级路径，头部会显式警告）。
 */
function renderLine(e, mapped) {
  const role = shortRole(e.role)
  // 与 mappedElements 同规则：首行 + 48 字符上限（PLAN-context-budget D）
  const rawLabel = labelOfElement(e)
  const NL = String.fromCharCode(10)
  const label = safeStr(rawLabel.split(NL)[0], 48) + (rawLabel.includes(NL) ? ' …' : '')
  const parts = [`[${e.element_index}] ${role}`]
  if (label) parts.push(`"${label}"`)
  // 输入框的当前值单列：label 往往是字段名（“文件名:”），值才是模型做决策所需的状态。
  const value = mapped && typeof mapped.value === 'string' ? mapped.value : displayValue(e)
  if (value && value !== label) parts.push(`值="${safeStr(value, 48)}"`)
  const c = mapped && Number.isFinite(mapped.x) && Number.isFinite(mapped.y)
    ? { x: mapped.x, y: mapped.y }
    : centerOf(e)
  if (c) parts.push(`@(${c.x},${c.y})`)
  return parts.join(' ')
}

/** 构造视觉提问（坐标系 = 截图像素 = 动作坐标）。 */
function visionQuestion(w, h) {
  return `这是一张电脑应用窗口的截图，宽 ${w}px，高 ${h}px（坐标原点左上角，坐标为窗口本地截图像素）。
请用中文描述界面内容，并列出所有可交互元素（按钮、输入框、菜单、链接、图标等），每项格式：
[序号] 类型 "文字" @(x,y)
坐标 x,y 为该元素中心在截图中的像素位置。只输出列表，最多 30 项，不要多余解释。`
}

/** base64 → Buffer。 */
function buf(b64) {
  return Buffer.from(String(b64 || ''), 'base64')
}

/**
 * 自动提权（观测侧，0.4.0 起常开）：
 *   - 窗口级观测失败 → 桌面级采集兜底（视觉仅读，坐标系=桌面像素）；
 *   - AX 树为空 → 标注 visualOnly；
 *   - 观测结果附驱动权限面（check_permissions 只读探测）。
 * 0.4.0 起：能力常开，不再受 permissionMode 开关控制（该配置已删除）。
 */

/**
 * 权限面缓存：check_permissions 在驱动侧约 2s/次，而权限在会话内几乎不变。
 * 30s TTL 既避免每次观察固定多付 2s，又能在 UAC/权限变化后较快重新探测。
 */
let ACCESS_CACHE = null   // { at, value }
const ACCESS_TTL_MS = 30000

/** 只读探测驱动权限面（win：完整性/UIA/PostMessage；mac：Accessibility/ScreenRecording）。失败返回 null。 */
async function driverAccess() {
  if (ACCESS_CACHE && Date.now() - ACCESS_CACHE.at <= ACCESS_TTL_MS) return ACCESS_CACHE.value
  try {
    const v = await cuaCall('check_permissions', {})
    if (!v || typeof v !== 'object') return null
    const value = {
      elevated: Boolean(v.elevated),
      integrityLevel: typeof v.integrity_level === 'string' ? v.integrity_level : null,
      uia: Boolean(v.uia),
      postMessage: Boolean(v.post_message),
    }
    ACCESS_CACHE = { at: Date.now(), value }
    return value
  } catch {
    return null
  }
}

/** 权限面 → 半行中文摘要（供结果头部展示）。 */
function accessNote(access) {
  if (!access) return ''
  const parts = []
  if (access.elevated) parts.push(`完整性=${access.integrityLevel || 'High'}`)
  if (access.uia) parts.push('UIA=可用')
  if (access.postMessage) parts.push('PostMessage=可用')
  if (!access.elevated) parts.push('非提权(管理员窗口不可观测)')
  return parts.length > 0 ? ` · 驱动权限: ${parts.join(' ')}` : ''
}

/**
 * 桌面级兜底观测（常开）：get_desktop_state 全屏视觉采集。
 * 注意：坐标系=桌面像素，与窗口级动作契约不同——此结果纯信息，明确不可直接用于
 * computer_click(x=,y=)（那是窗口本地截图像素）。成功返回 ok:true（无 image 时也返回
 * 文本信息），再次失败则抛原错误，由 wrap 统一兜底。
 */
async function desktopFallback(ctx, cfg, exec, target, reason, access) {
  const ds = await cuaCall('get_desktop_state', {})
  const w = ds?.screenshot_width || 0
  const h = ds?.screenshot_height || 0
  const b64 = ds?.screenshot_png_b64
  let image = null
  if (b64) {
    try {
      const attachments = ctx?.get?.('attachments')
      if (attachments) {
        image = await saveImageAttachment(attachments, {
          data: buf(b64),
          mediaType: ds.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
          name: 'screen-desktop-fallback.png',
        }, { width: w, height: h })
      }
    } catch { /* 图片不可直读时不阻塞信息文本 */ }
  }
  const scope = target ? `（目标 ${target.app_name || target.pid || '?'} / ${target.window_id || '?'}）` : ''
  const result =
    `[观测降级] 窗口级观测被权限/引擎拒绝，已自动降级为桌面级采集${scope}：${reason}\n` +
    `桌面 ${w}×${h}px，坐标系=显示器像素。注意：本截图仅供阅读界面内容，` +
    `computer_click/scroll/drag 坐标仍指窗口本地截图像素——如需操作请重试 screen_observe（或对普通窗口观测）。` +
    (accessNote(access))
  return {
    ok: true,
    result,
    window: target ? {
      pid: target.pid, windowId: target.window_id,
      app: safeStr(target.app_name || '', 60), title: safeStr(target.title || '', 80),
    } : null,
    elementCount: 0,
    mode: 'desktop-visual',
    elements: [],
    visualOnly: true,
    driverAccess: access,
    image,
  }
}

/** screen_observe 主流程里 window 级 get_window_state 包装：失败时自动降级桌面级采集（常开）。 */
async function observeWindowState(ctx, cfg, exec, target, gwArgs, access) {
  try {
    return await cuaCall('get_window_state', gwArgs)
  } catch (err) {
    return { __desktopFallback: await desktopFallback(ctx, cfg, exec, target, err.message, access) }
  }
}

/**
 * 把 get_window_state 的截图提交到 attachments（原生直读 / 观察者都需要）。
 *
 * 注意：cua-driver 0.23.2 的 zoom 只能裁 ≤500px 宽的区域，并会自动加 padding/缩放，
 * 无法做“整窗紧凑图”。因此超限时不再假装 compact 成功，而是给可执行错误：
 * 改 ax/vision，或用 screen_zoom 指定区域。
 * @returns {Promise<{image:object, width:number, height:number}>} image 为装配好的附件块
 */
async function commitScreenshot(ctx, target, state, cfg) {
  const attachments = ctx?.get?.('attachments')
  if (!attachments) {
    throw new Error('当前环境未挂载 attachments 服务，无法持久化截图（原生视觉不可用）。')
  }
  const pngBuf = buf(state.screenshot_png_b64)
  const limits = attachments.imageLimits || {}
  const finiteLimit = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : Infinity
  }
  const maxBytes = finiteLimit(limits.maxImageBytes) === Infinity
    ? 5 * 1024 * 1024
    : finiteLimit(limits.maxImageBytes)
  const width = Number(state.screenshot_width) || 0
  const height = Number(state.screenshot_height) || 0
  // dsh 0.2.2 的附件限额不只有字节数：还限制单边尺寸与总像素。
  const tooLarge = pngBuf.byteLength > maxBytes
    || (width > 0 && width > finiteLimit(limits.maxImageDimension))
    || (height > 0 && height > finiteLimit(limits.maxImageDimension))
    || (width > 0 && height > 0 && width * height > finiteLimit(limits.maxImagePixels))

  if (cfg.nativeImage === 'compact' || (cfg.nativeImage !== 'full' && tooLarge)) {
    throw new Error(
      '紧凑截图不可用：cua-driver 0.23.2 的 zoom 不支持整窗缩放（请求区域宽上限 500px）。'
      + '请改用 mode=ax / mode=vision，或用 screen_zoom 指定 ≤500px 区域；不要重复同一请求。',
    )
  }

  const image = await saveImageAttachment(attachments, {
    data: pngBuf,
    mediaType: state.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    name: `screen-${target.pid}.png`,
  }, { width, height })
  return { image, width, height }
}

/** 观察者（Mode D）：DeepSeek 视觉模型描述，失败回退 GLM。 */
async function describeVision(ctx, cfg, state, target, exec, question) {
  const w = state.screenshot_width || 0
  const h = state.screenshot_height || 0
  const q = question || visionQuestion(w, h)
  // 1. 优先 DeepSeek 观察者（需 attachments 持久化 + llm 服务）
  const attachments = ctx?.get?.('attachments')
  const llm = ctx?.get?.('llm')
  if (llm && attachments) {
    try {
      const { image: shot } = await commitScreenshot(ctx, target, state, cfg)
      const text = await deepseekVisionDescribe(ctx, cfg, {
        imageRef: shot,
        question: q,
      })
      return `（观察者 ${cfg.visionProvider}/${cfg.visionModel}）\n${text}`
    } catch (err) {
      // 观察者不可用 → 记录后走 GLM
      return `（DeepSeek 观察者不可用：${err.message}）\n${await glmVisionDescribe({
        imageBase64: state.screenshot_png_b64,
        mimeType: state.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        question: q,
      }).catch((e2) => `（视觉理解失败：${e2.message}）`)}`
    }
  }
  // 2. 无 llm/attachments：GLM 直传
  return glmVisionDescribe({
    imageBase64: state.screenshot_png_b64,
    mimeType: state.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    question: q,
  }).catch((err) => `（视觉理解失败：${err.message}）`)
}

/** 是否需要为"树空/降级"补一次带截图的观察（ax 模式下模型可看图时）。 */
function missingTreeFallback(wantMode, state, rawElements) {
  return wantMode !== 'vision' && wantMode !== 'native'
    && (Boolean(state.degraded_reason) || rawElements.length === 0)
}

/** 观察结果缓存为快照（element_token 自带引擎侧校验，双保险之一）。scan 存在时标记结构性密码元素。 */
function cacheSnapshot(cfg, target, state, elements, effectiveMode, scan, logicalSnapshotId = null, maxElements = null) {
  const entries = new Map()
  const org = screenOriginOf(target)
  for (const e of elements) {
    const c = centerOf(e)
    // 快照条目的 x/y 必须与文本行、结构化 elements、computer_click 同一空间：
    // driver frame 是屏幕物理像素，点击空间是窗口截图坐标，差值就是窗口原点。
    const x = c ? Math.round(org ? c.x - org.x : c.x) : null
    const y = c ? Math.round(org ? c.y - org.y : c.y) : null
    entries.set(e.element_index, {
      token: e.element_token,
      role: safeStr(e.role, 40),
      label: safeStr(e.label || '', 100),
      value: safeStr(e.value || '', 100),
      x,
      y,
      is_password: Boolean(e.is_password),
    })
  }
  setSnapshot({
    at: Date.now(),
    ttlMs: cfg.ttlMs,
    pid: target.pid,
    windowId: target.window_id,
    appName: target.app_name || '',
    coordinateSpace: org ? 'window-screenshot-px' : 'screen-physical-px',
    screenOrigin: org,
    snapshotId: logicalSnapshotId ?? state.snapshot_id,
    title: target.title || '',
    entries,
    elementCount: state.element_count,
    totalElementCount: state.total_element_count,
    mode: effectiveMode,
    maxElements: Number(maxElements) > 0 ? Number(maxElements) : (cfg.maxElements || 120),
    screenshotWidth: state.screenshot_width || null,
    screenshotHeight: state.screenshot_height || null,
  })
}

/**
 * 模式决策（native / vision / ax + 自动降级链）。
 * @returns {{effectiveMode:string, visionText:string, image:object|null, fail?:{ok:false,result:string}}}
 */
async function resolveObserveMode(ctx, cfg, exec, { state, target, wantMode, degraded }) {
  let effectiveMode = 'ax'
  let visionText = ''
  let image = null

  if (wantMode === 'native') {
    const capable = await routeImageCapable(ctx, exec)
    if (!capable) {
      const { provider, model } = { provider: exec?.agent?.options?.provider, model: exec?.agent?.options?.model }
      return { effectiveMode, visionText, image, fail: { ok: false, result: `原生视觉模式（mode="native"）需要当前对话模型支持图片输入，但当前 route ${provider}/${model} 未声明 image 能力。请切换到视觉模型（如 deepseek-flash），或使用 mode="vision"（观察者）/ mode="ax"。` } }
    }
    try {
      const { image: shot } = await commitScreenshot(ctx, target, state, cfg)
      image = shot
      effectiveMode = 'native'
      visionText = ''
    } catch (err) {
      return { effectiveMode, visionText, image, fail: { ok: false, result: `原生截图失败：${err.message}` } }
    }
  } else if (wantMode === 'vision') {
    visionText = await describeVision(ctx, cfg, state, target, exec)
    effectiveMode = 'vision'
  } else { // ax 默认
    if (degraded) {
      if (await routeImageCapable(ctx, exec)) {
        try {
          const { image: shot } = await commitScreenshot(ctx, target, state, cfg)
          image = shot
          effectiveMode = 'native'
        } catch {
          effectiveMode = 'ax'
        }
      } else if (glmVisionConfigured()) {
        visionText = await describeVision(ctx, cfg, state, target, exec)
        effectiveMode = 'vision'
      }
    }
  }
  return { effectiveMode, visionText, image }
}

/**
 * 执行 screen_observe。
 * @param {object} ctx - Cordis 上下文（llm / attachments 服务）
 * @param {object} args - { window?, mode?, query?, maxElements? }
 * @param {object} cfg - 插件配置（ttlMs / maxElements / nativeImage / visionProvider / visionModel）
 * @param {object} exec - 工具执行上下文（取当前 route）
 */
// ── 重复观察降噪（PLAN-observe-noise）─────────────────────────────────
// 依据：S4 实测 observe:动作 ≈ 2-3:1，单回合输入曾达 8.5M tok；且这是插件契约诱发的
// 固定节律（动作要求新鲜快照 → 模型每个动作前都重观察，即使界面没变）。
// 拍板（2026-09-16）：D1 形态可配 brief/summary/off（默认 summary）；D2 严格哈希 + 忽略
// 时间类文本；D3 加 force 参数；D4 默认 maxElements 降到 120。
const DEDUP_STATE = new Map()   // windowKey -> { hash, snapshotId, elementCount, digest, at, elements }
const OBSERVE_HISTORY = new Map()   // windowKey -> { title, at, els: Map<index, rawElement> }
const OBSERVE_HISTORY_MAX = 8
/**
 * 最近一次 driver zoom 的元数据（按 pid，与驱动 "last zoom image for this pid" 对齐）。
 * from_zoom 点击必须证明：zoom 与当前快照同 pid/window，且 zoom 不早于当前观察。
 * 插件不会再基于请求 crop 手算 scale——驱动会加 20% padding 并可能缩放。
 */
const LAST_ZOOM = new Map()   // pid -> { pid, windowId, at, imageW, imageH }
const ZOOM_TTL_MS = 60000

export function noteZoom(pid, windowId, meta = {}) {
  const p = Number(pid)
  if (!Number.isFinite(p) || p <= 0) return
  LAST_ZOOM.set(p, {
    pid: p,
    windowId: Number(windowId),
    at: Date.now(),
    imageW: Number(meta.imageW) || null,
    imageH: Number(meta.imageH) || null,
  })
  if (LAST_ZOOM.size > 8) LAST_ZOOM.delete(LAST_ZOOM.keys().next().value)
}

export function clearZoom(pid) {
  if (pid === undefined || pid === null) LAST_ZOOM.clear()
  else LAST_ZOOM.delete(Number(pid))
}

/** 取当前有效 zoom；window 不一致或超过 TTL 返回 null（由调用方给重新 zoom 指引）。 */
export function getLastZoom(pid, windowId) {
  const p = Number(pid)
  const z = LAST_ZOOM.get(p)
  if (!z) return null
  if (Number(z.windowId) !== Number(windowId)) return null
  if (Date.now() - z.at > ZOOM_TTL_MS) {
    LAST_ZOOM.delete(p)
    return null
  }
  return z
}

/** 观察差分用的元素内容指纹：不含 frame（窗口移动/缩放不应被误报成界面内容变化）。 */
function contentFingerprint(e) {
  return [
    String(e.role || ''),
    normalizeForHash(e.label ?? ''),
    e.valueHash ?? normalizeForHash(e.value ?? ''),
    e.enabled === undefined ? '' : String(e.enabled),
    e.selected === undefined ? '' : String(e.selected),
  ].join('|')
}

/**
 * 差分历史只保留紧凑指纹，不保留 Document 正文：
 * 值用 normalizeForHash 后的 SHA-1 参与比较，显示只用首行 48 字符。
 */
function compactForHistory(e) {
  const v = String(e.value ?? '')
  return {
    role: e.role || '',
    label: safeStr(e.label ?? '', 120),
    value: safeStr(v.split(String.fromCharCode(10))[0], 48),
    valueHash: v ? createHash('sha1').update(normalizeForHash(v)).digest('hex') : '',
    enabled: e.enabled,
    selected: e.selected,
    is_password: Boolean(e.is_password),
  }
}

function shortText(v, n = 24) {
  const s = String(v ?? '').split(String.fromCharCode(10))[0]
  return s.length > n ? s.slice(0, n) + '…' : s
}

function observeKeyOf(target) {
  return `${target.pid}:${target.window_id}`
}

/**
 * 计算“自上次观察以来”的内容差分（2026-11-15 t01 实证）。
 *
 * 动作回执多数是 unverifiable；模型唯一的证据来源是下一次观察。只回“状态未变/全量树”
 * 时，模型分不清“输入已生效”还是“没生效”，于是重复输入/重复点击。这里把标题、
 * 输入框当前值、状态栏文本（如“33 个字符”）、元素增删做成一行短差分，让模型立即停止重试。
 * 时间/行列噪声走 normalizeForHash，不误报；Document 正文只报“文档内容变化”，不外显。
 */
function diffObserve(target, rawEls) {
  const key = observeKeyOf(target)
  const prev = OBSERVE_HISTORY.get(key)
  const next = new Map((rawEls || []).map((e) => [e.element_index, compactForHistory(e)]))
  const out = { changed: null, titleChanged: false, added: 0, removed: 0, changedCount: 0, summary: '' }
  if (!prev) {
    OBSERVE_HISTORY.set(key, { title: target.title || '', at: Date.now(), els: next })
    if (OBSERVE_HISTORY.size > OBSERVE_HISTORY_MAX) {
      OBSERVE_HISTORY.delete(OBSERVE_HISTORY.keys().next().value)
    }
    return out
  }
  const parts = []
  if (normalizeForHash(prev.title) !== normalizeForHash(target.title || '')) {
    out.titleChanged = true
    parts.push(`标题 “${shortText(prev.title, 40)}” → “${shortText(target.title, 40)}”`)
  }
  for (const i of next.keys()) if (!prev.els.has(i)) out.added++
  for (const i of prev.els.keys()) if (!next.has(i)) out.removed++
  if (out.added || out.removed) parts.push(`元素 +${out.added}/-${out.removed}`)
  const changed = []
  for (const [i, e] of next) {
    const old = prev.els.get(i)
    if (!old || contentFingerprint(old) === contentFingerprint(e)) continue
    out.changedCount++
    if (changed.length >= 4) continue
    const role = shortRole(e.role)
    if (e.is_password || SECRET_ROLES.has(String(e.role || ''))) {
      changed.push(`[${i}] ${role} 值变化（隐藏）`)
      continue
    }
    const oldV = String(old.value ?? '')
    const newV = String(e.value ?? '')
    const oldL = String(old.label ?? '')
    const newL = String(e.label ?? '')
    if (VALUE_ROLES.has(String(e.role || '')) && (old.valueHash || oldV) !== (e.valueHash || newV)) {
      changed.push(`[${i}] ${role} “${shortText(oldV)}” → “${shortText(newV)}”`)
    } else if (normalizeForHash(oldL) !== normalizeForHash(newL)) {
      changed.push(`[${i}] ${role} “${shortText(oldL)}” → “${shortText(newL)}”`)
    } else if (/Document|TextArea/i.test(String(e.role || ''))) {
      changed.push(`[${i}] ${role} 内容变化`)
    } else {
      changed.push(`[${i}] ${role} 状态变化`)
    }
  }
  if (changed.length) parts.push(changed.join('；'))
  if (out.changedCount > changed.length) parts.push(`另有 ${out.changedCount - changed.length} 项变化`)
  out.changed = parts.length > 0
  out.summary = parts.length ? parts.join('；') : '无可见变化'
  OBSERVE_HISTORY.set(key, { title: target.title || '', at: Date.now(), els: next })
  return out
}

/** 哈希前归一化：剔除不含语义的噪声（时间、行列指示），其余（标签/坐标/标题/bounds）全参与。 */
function normalizeForHash(s) {
  return String(s ?? '')
    .replace(/\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?/gi, '<time>')      // 12:34 / 12:34:56
    .replace(/(line|行)\s*\d+\s*[,，]\s*(col|column|列)\s*\d+/gi, '<caret>')  // 行 1，列 1
    .replace(/\s+/g, ' ')
    .trim()
}

function dedupKeyOf(target, mode) {
  return `${target.pid}:${target.window_id}:${mode}`
}

function hashOfPayload(target, els, rawEls = []) {
  const parts = [
    target.app_name || '', normalizeForHash(target.title || ''),
    target.bounds ? `${target.bounds.x},${target.bounds.y},${target.bounds.width},${target.bounds.height}` : '',
  ]
  if (rawEls.length > 0) {
    // 严格指纹：必须覆盖会影响"界面是否变化"的全部语义字段。
    // 旧实现只看映射后的 label（label || value，且截断 48 字符），当 Edit 的 label 非空时
    // value 完全不参与 → 文本变化被误判"状态未变"（2026-11-09 P1-B）。
    for (const e of rawEls) {
      const f = e.frame || {}
      parts.push([
        e.element_index,
        e.role,
        normalizeForHash(e.label ?? ''),
        normalizeForHash(e.value ?? ''),
        e.enabled === undefined ? '' : String(e.enabled),
        e.selected === undefined ? '' : String(e.selected),
        (Array.isArray(e.actions) ? e.actions.join(',') : ''),
        e.is_password === true ? 'pw' : '',
        e.parent_index ?? '',
        e.depth ?? '',
        `${f.x ?? ''},${f.y ?? ''},${f.w ?? f.width ?? ''},${f.h ?? f.height ?? ''}`,
      ].join('|'))
    }
  } else {
    // 兜底：没有原始元素时用映射后的最小字段（仅测试/旧调用点）。
    for (const e of els) parts.push(`${e.index}|${e.role}|${normalizeForHash(e.label)}|${e.x},${e.y}`)
  }
  return createHash('sha1').update(parts.join('\n')).digest('hex')
}

function dedupStub(cfg, target, hit, mode, form) {
  const head = `窗口: ${safeStr(target.app_name)} · ${safeStr(target.title)}`
  const snap = getSnapshot()
  const dims = snap?.screenshotWidth && snap?.screenshotHeight
    ? `（源图 ${snap.screenshotWidth}×${snap.screenshotHeight}px）`
    : ''
  const base = `状态未变（快照 ${hit.snapshotId}，元素 ${hit.elementCount} 个，编号仍有效）。坐标=窗口截图原图像素${dims}（与 computer_click 同空间；预览缩放时用 screen_zoom+from_zoom=true）。`
  if (form === 'brief') return `${head}\n${base}`
  const keyLines = Array.isArray(hit.keyLines) && hit.keyLines.length
    ? `\n关键控件: ${hit.keyLines.join(' | ')}`
    : ''
  return `${head}\n${base}${keyLines}\n上次观察摘要: ${hit.digest}\n如需强制全量：screen_observe(force=true)`
}

/** 降噪 stub 的关键控件摘要：让模型不必为“编号在哪”再 force/native 一次。 */
function keyLinesOf(els) {
  return (els || [])
    .filter((e) => /输入框|下拉框|按钮|菜单项|标签页|列表项|复选|单选/.test(String(e.role || '')))
    .slice(0, 4)
    .map((e) => {
      const val = e.value && e.value !== e.label ? ` 值="${safeStr(e.value, 24)}"` : ''
      return `[${e.index}] ${e.role} "${safeStr(e.label, 24)}"${val}`
    })
}

/**
 * 未变判定与缓存（调用点：screenObserve 映射完元素之后）。
 * 命中 → 返回 stub 文本（走极简回执）；未命中 → 记录哈希并返回 null（走全量）。
 * force=true / 带 query / observeDedup=off 一律走全量。
 */
export function dedupEvaluate(cfg, target, mode, args, els, sid, consumedBefore = false, rawEls = [], suspectBefore = false) {
  if ((cfg.observeDedup || 'summary') === 'off') return null
  const key = dedupKeyOf(target, mode)
  const hash = hashOfPayload(target, els, rawEls)
  const prev = DEDUP_STATE.get(key)
  // 摘要只保留编号+角色（编号是模型继续动作所必需的；标签与坐标在上文里仍有）
  const digest = els.slice(0, 10).map((e) => `${e.index}:${e.role}`).join(' ') + (els.length > 10 ? ` …共${els.length}项` : '')
  // 快照被标 suspect 时不得再用“状态未变” stub：上次动作是否生效未知，必须给全量树。
  // suspectBefore 必须在 cacheSnapshot 之前捕获（安装新快照会清掉 suspect）。
  if (suspectBefore) return null
  // 只有"上次观察之后没有任何动作"（快照未被消费）时才敢断言状态未变——驱动每次观察都会给新
  // snapshot id（实测 s000001a3→s000001a4），所以不能用 sid 相等做判定，必须用插件的消费状态。
  const untouched = prev && prev.hash === hash && !consumedBefore
  if (!args.force && !args.query && untouched) {
    return {
      text: dedupStub(cfg, target, { ...prev, snapshotId: sid, elementCount: els.length }, mode, cfg.observeDedup || 'summary'),
      elements: prev.elements || [],
    }
  }
  DEDUP_STATE.set(key, {
    hash, snapshotId: sid, elementCount: els.length, digest, at: Date.now(),
    elements: els, keyLines: keyLinesOf(els),
  })
  return null
}

/** 清空降噪/差分/权限缓存（插件重新 apply / 会话重置时调用，避免陈旧状态被复用）。 */
export function dedupReset() {
  DEDUP_STATE.clear()
  OBSERVE_HISTORY.clear()
  LAST_ZOOM.clear()
  ACCESS_CACHE = null
}

/**
 * 阶段 1：窗口列表 + 目标窗口选择。
 * window 参数支持 pid 数字 / 标题子串 / 应用名子串；window_id 精确匹配；
 * 同一 pid 有多个窗口时优先 on-screen、z 序更前、标题更具体的窗口（t01 实测：
 * 首个 pid 匹配可能是 223×32 的辅助/离屏窗口）。
 * 指定了目标但没有匹配 → notFound（fail closed，绝不静默回退到最前窗口）。
 */
function rankWindows(a, b) {
  const onScreen = (w) => (w.is_on_screen === false ? 0 : 1)
  const specific = (w) => (w.title && w.title !== w.app_name ? 1 : 0)
  return (onScreen(b) - onScreen(a))
    || ((Number(b.z_index) || 0) - (Number(a.z_index) || 0))
    || (specific(b) - specific(a))
}

/**
 * z 序不是 OS 前台，但“目标明显落后于另一个在屏窗口”足以提示模型先 activate。
 * z_index 为 null 时驱动明确要求不得推断顺序，因此不发提示。
 */
function foregroundHint(target, frontWindow, { short = false } = {}) {
  if (!target || !frontWindow) return ''
  if (Number(target.window_id) === Number(frontWindow.window_id)) return ''
  if (target.is_on_screen === false || frontWindow.is_on_screen === false) return ''
  const tz = target.z_index === null || target.z_index === undefined ? NaN : Number(target.z_index)
  const fz = frontWindow.z_index === null || frontWindow.z_index === undefined ? NaN : Number(frontWindow.z_index)
  if (!Number.isFinite(tz) || !Number.isFinite(fz) || fz <= tz) return ''
  if (!String(frontWindow.title || '').trim()) return ''
  const act = `computer_activate(pid=${target.pid}, window_id=${target.window_id})`
  return short
    ? `前台提示：目标通常不在前台；键盘/画布/foreground 动作前先 ${act}，不要 Alt+Tab/任务栏。`
    : `前台提示：目标不在 z 序最前（前窗 pid=${frontWindow.pid} window_id=${frontWindow.window_id}），通常不是前台窗口；`
      + `需要键盘/画布/foreground 动作时先 ${act}（dispatcher 下经 computer_do），不要用 Alt+Tab 或点任务栏。后台 element 点击不需要。`
}

/** 窗口标题/应用名归一：去掉 .exe、大小写、全角空格。 */
function normalizeWindowText(s) {
  let t = String(s ?? '').toLowerCase()
  try { t = t.normalize('NFKC') } catch { /* 老 Node 无 NFKC 时保持原样 */ }
  return t.replace(/\.exe\b/g, '').replace(/\s+/g, ' ').trim()
}

/** 常见应用的中英别名（只用于“找不到”时扩大匹配，不覆盖 title 优先级）。 */
const WINDOW_ALIASES = new Map([
  ['记事本', 'notepad'], ['notepad', 'notepad'],
  ['计算器', 'calculator'], ['calculator', 'calculator'],
  ['画图', 'paint'], ['paint', 'paint'],
  ['文件资源管理器', 'explorer'], ['资源管理器', 'explorer'], ['explorer', 'explorer'],
])
const windowAlias = (s) => WINDOW_ALIASES.get(normalizeWindowText(s)) || normalizeWindowText(s)

function windowTextMatches(w, want) {
  const wantN = normalizeWindowText(want)
  const wantA = windowAlias(want)
  const title = normalizeWindowText(w.title)
  const app = normalizeWindowText(w.app_name)
  return title.includes(wantN) || app.includes(wantN)
    || windowAlias(title).includes(wantA) || windowAlias(app).includes(wantA)
}

/**
 * 插件自己的 agent 光标覆盖层（cua-driver 宿主窗口）。
 * 它不是用户应用：观察它会拿到桌面级降级，还会挤掉当前有效的应用快照。
 * 2026-11-15 t01 r3 实证：notFound 候选列表里出现它之后，模型连续 4 次去观察它。
 */
function isAgentOverlayWindow(w) {
  const title = normalizeWindowText(w?.title)
  const app = normalizeWindowText(w?.app_name)
  return title.startsWith('cua.agentcursoroverlay')
    || title.includes('agentcursoroverlay')
    || title.includes('cursor overlay')
    || title.includes('computer use cursor overlay')
    || app === 'cua-driver'
    || app === 'codex-computer-use'
    || app === 'cua-cursor-theme'
}

/** 失败观察的目标是否就是当前快照窗口（决定要不要清快照）。 */
function sameSnapshotWindow(snap, target) {
  return Boolean(snap && target
    && Number(snap.pid) === Number(target.pid)
    && Number(snap.windowId) === Number(target.window_id))
}

/** 旧快照仍有效时的提示（notFound / 不同窗口降级共用）。 */
function keptSnapshotNote() {
  const snap = getSnapshot()
  if (!snap) return ''
  return `\n旧快照仍有效：snapshot=${snap.snapshotId ?? '?'} pid=${snap.pid} window_id=${snap.windowId}；`
    + '若目标就是它，可继续使用原编号；若目标已变，请重新观察目标窗口。'
}

async function pickObserveTarget(args) {
  const winList = await cuaCall('list_windows', { on_screen_only: true })
  rememberWindows(winList.windows || [])
  const rawWindows = (winList.windows || []).filter((w) => w.window_id && (w.title || w.app_name))
  const overlayWindows = rawWindows.filter(isAgentOverlayWindow)
  const windows = rawWindows.filter((w) => !isAgentOverlayWindow(w))
  const frontWindow = windows.length ? [...windows].sort(rankWindows)[0] : null
  const wantId = args.window_id
  const want = args.window
  const hasWant = want !== undefined && want !== null && want !== ''

  // 显式指定 overlay 时给专门错误：这不是“没找到”，而是永远不该作为操作目标。
  const wantedOverlay = overlayWindows.find((w) => {
    if (wantId !== undefined && wantId !== null && wantId !== '') {
      return Number(w.window_id) === Number(wantId)
    }
    if (!hasWant) return false
    return String(w.pid) === String(want) || windowTextMatches(w, want)
  })
  if (wantedOverlay) {
    return {
      overlay: true,
      want: String(wantId ?? want),
      title: safeStr(wantedOverlay.title || '', 80),
    }
  }

  if (windows.length === 0) {
    return { none: true, onlyOverlay: overlayWindows.length > 0 }
  }

  const candidates = windows.slice(0, 8)
    .map((w) => `${safeStr(w.app_name || '?', 40)} · ${safeStr(w.title || '?', 60)} · pid=${w.pid} window_id=${w.window_id}`)
  const notFound = (w) => ({ notFound: true, want: String(w), candidates })

  if (wantId !== undefined && wantId !== null && wantId !== '') {
    const target = windows.find((w) => Number(w.window_id) === Number(wantId))
    return target ? { target, frontWindow, pickedFrontmost: false, matchCount: 1 } : notFound(wantId)
  }

  let target = null
  if (hasWant) {
    const wantStr = String(want)
    const byPid = windows.filter((w) => String(w.pid) === wantStr).sort(rankWindows)
    if (byPid.length) return { target: byPid[0], frontWindow, pickedFrontmost: false, matchCount: byPid.length }
    // title 精确/子串优先；应用名与中英别名作为 fallback，但 matchCount 用并集，
    // 这样“Notepad”同时命中标题和 app 时也会给出多窗口警告。
    const titleMatches = windows
      .filter((w) => normalizeWindowText(w.title).includes(normalizeWindowText(wantStr)))
      .sort(rankWindows)
    const aliasMatches = windows
      .filter((w) => !titleMatches.includes(w) && windowTextMatches(w, wantStr))
      .sort(rankWindows)
    const matches = [...titleMatches, ...aliasMatches]
    target = matches[0]
    if (!target) return notFound(wantStr)
    // 同标题/同应用多窗口（多个“另存为”对话框）不能静默只取最前。
    return { target, frontWindow, pickedFrontmost: false, matchCount: matches.length }
  }
  target = [...windows].sort(rankWindows)[0]
  return { target, frontWindow, pickedFrontmost: true, matchCount: 1 }
}

/**
 * 阶段 2：抓窗口 AX 树（vision / native 模式同时抓截图）。
 * 截图缺失但确实需要（树空且模型能读图）→ 补抓一次；窗口级被拒 → 短路返回桌面级降级回执。
 */
async function fetchWindowTree(ctx, cfg, exec, target, { wantMode, maxElements, query, access }) {
  const needShot = wantMode === 'vision' || wantMode === 'native'
  const gwArgs = {
    pid: target.pid,
    window_id: target.window_id,
    include_screenshot: needShot,
    max_elements: maxElements,
  }
  if (query) gwArgs.query = String(query)

  let state = await observeWindowState(ctx, cfg, exec, target, gwArgs, access)
  if (state && state.__desktopFallback) return { fallback: state.__desktopFallback }
  const rawElements = Array.isArray(state.elements) ? state.elements : []
  const needShotNow = needShot || (missingTreeFallback(wantMode, state, rawElements)
    && (await routeImageCapable(ctx, exec) || glmVisionConfigured()))
  if (needShotNow && !state.screenshot_png_b64) {
    const v = await observeWindowState(ctx, cfg, exec, target, {
      pid: target.pid,
      window_id: target.window_id,
      include_screenshot: true,
      max_elements: maxElements,
    }, access)
    if (v && v.__desktopFallback) return { fallback: v.__desktopFallback }
    state = { ...state, ...v }
  }
  return { state, rawElements }
}

/**
 * 阶段 3：结构性密码标记（Windows UIA sidecar；失败/skipped 静默降级启发式）。
 * PLAN-credential-guard 第二期：凭据硬保护的结构性依据。
 */
async function markStructuralPasswords(cfg, target, elements) {
  if (!(IS_WINDOWS && cfg.passwordScan !== 'off' && elements.length > 0)) return { scan: null, scanNote: '' }
  const scan = await scanPasswords({ hwnd: target.window_id, timeoutMs: 5000 })
  if (!scan) return { scan: null, scanNote: '（结构密码扫描不可用，凭据保护运行于启发式）' }
  const marked = markElementsFromScan(elements, scan)
  return { scan, scanNote: marked > 0 ? `（结构密码标记 ${marked} 项：IsPassword/ES_PASSWORD 实测）` : '' }
}

/**
 * 阶段 4：元素 → 模型可见编号表。
 * 坐标在**输出时**换算进点击空间（截图、元素坐标、点击三者同一空间，"所见即所点"）；
 * 内部标记/密码扫描仍用原始屏幕坐标，不受影响。
 */
function mapElementsForModel(target, elements) {
  const org = screenOriginOf(target)
  const toClickSpace = (v, o) => (v === null || !org || o === null ? v : Math.round(v - o))
  return elements.map((e) => {
    const c = centerOf(e)
    return {
      index: e.element_index,
      role: safeStr(shortRole(e.role), 40),
      // PLAN-context-budget D（保守两步）：标签 100→48 字符 + 多行折首行——
      // 超长/多行多为文档正文，需要全文时用 native/zoom 读；树里留短标签足够选目标。
      label: (() => {
        const raw = labelOfElement(e)
        const first = raw.split('\n')[0]
        return safeStr(first, 48) + (raw.includes('\n') ? ' …' : '')
      })(),
      value: displayValue(e),
      x: c ? toClickSpace(c.x, org?.x ?? null) : null,
      y: c ? toClickSpace(c.y, org?.y ?? null) : null,
    }
  })
}

/** 阶段 5：文本渲染（头部 + 正文 + 视觉块）。 */
function renderObserveText({ target, frontWindow, pickedFrontmost, matchCount, effectiveMode, degraded, wantMode, access, scanNote, state, lines, elements, changes, visionText, queryOnly = false }) {
  let modeNote = `模式=${effectiveMode}`
  if (effectiveMode === 'vision') {
    modeNote += degraded && wantMode !== 'vision' ? '（AX 树为空自动降级）' : ''
  } else if (effectiveMode === 'native') {
    modeNote += degraded && wantMode !== 'native' ? '（AX 树为空自动降级）' : ''
  }
  modeNote += accessNote(access)
  modeNote += scanNote
  const srcW = Number(state?.screenshot_width) || 0
  const srcH = Number(state?.screenshot_height) || 0
  const srcDims = srcW > 0 && srcH > 0 ? `（源图 ${srcW}×${srcH}px）` : ''
  const coordNote = screenOriginOf(target)
    ? `坐标=窗口截图原图像素${srcDims}（与 computer_click 同空间，可直接传）。若界面预览被缩放，勿按预览显示尺寸估坐标；像素定位用 screen_zoom + from_zoom=true。`
    : '坐标=屏幕物理像素（缺少窗口 bounds，未换算；不要直接用于 computer_click，请用 element 编号或重新观察；也不要按缩放预览的显示尺寸估坐标）。'
  const hasInput = (elements || []).some((e) => VALUE_ROLES.has(String(e.role || '')))
  // 顶层菜单栏标签不是“菜单已打开”；系统菜单项（系统/System）也不是弹出菜单。
  const menu = menuStateOf(elements)
  const hasDocument = (elements || []).some((e) => DOCUMENT_ROLES.test(String(e.role || '')))
  const docEl = (elements || []).find((e) => DOCUMENT_ROLES.test(String(e.role || '')))
  const header = [
    `窗口: ${safeStr(target.app_name)} · ${safeStr(target.title)}`,
    `pid=${target.pid} window_id=${target.window_id} ${modeNote} ${coordNote}`,
    foregroundHint(target, frontWindow) || null,
    queryOnly
      ? 'query 过滤视图（只读）：仅显示匹配元素，未建立动作快照；元素编号不能用于动作。需要动作/from_zoom 请不带 query 重新 screen_observe。'
      : null,
    pickedFrontmost
      ? '注意：本次未指定 window 参数，已按 z 序取最前窗口（上）——若目标不是它，请显式传 window=<pid 或标题子串> 重新观察。'
      : null,
    matchCount > 1
      ? `注意：目标匹配 ${matchCount} 个窗口，已取 z 序最前（pid=${target.pid} window_id=${target.window_id}）；多窗口请改用 window_id。`
      : null,
    changes && changes.changed !== null ? `自上次观察：${changes.summary}` : null,
    hasInput
      ? '输入框提示：可直接 computer_type(element=编号, text=...)；set_value 报“无 ValuePattern”时不要三连击/连续退格。'
      : null,
    hasDocument
      ? `文档窗口提示：输入优先 computer_type(element=${docEl?.element_index ?? '<文档编号>'}, text=...) + 默认后台投递；UIA 注入可能不置“未保存”标记，不要据此判断输入失败；星号/“未修改”不是失败证据，不要用 SPACE/BACKSPACE/重复输入强制置脏；无 element 的焦点输入在 WinUI 可能 delivery_failed/丢字。`
      : null,
    menu.count >= 3 ? '菜单已打开：直接点菜单项编号，不要重复点菜单栏。' : null,
    effectiveMode === 'ax'
      ? `可见元素 ${lines.length} 个（树共 ${state.element_count}/${state.total_element_count}${queryOnly ? '，只读视图，无动作快照' : `，快照 ${state.snapshot_id}`}）`
      : effectiveMode === 'native'
        ? `AX 元素 ${lines.length} 个，原生直读截图如下 ${visionText}`
        : `AX 元素 ${lines.length} 个，视觉描述如下`,
  ].filter(Boolean).join('\n')

  let body = lines.length > 0
    ? lines.join('\n')
    : effectiveMode === 'native'
      ? '(AX 树无可用元素 —— 请直接看图，用截图坐标点击)'
      : '(AX 树无可用元素)'
  if (degraded && lines.length === 0) {
    body += '（visualOnly: 本窗口无可用 AX 树，仅有视觉信息；元素编号不可用，坐标点击仍按截图传 x=,y=）'
  }
  const visionBlock = visionText && effectiveMode === 'vision' ? `\n── 视觉理解 ──\n${visionText}` : ''
  return { header, body, visionBlock }
}

/**
 * 阶段 6：结果封装（降噪桩与全量回执共用同一字段集与字段顺序，避免两处漂移）。
 * 字段顺序对宿主/模型可见（JSON 序列化），改动需同步 schema.conformance。
 */
function observePayload({ ok, result, target, access, elementCount, effectiveMode, visualOnly, sid, elements, screenshotFile, image, changes }) {
  return {
    ok,
    result,
    window: { pid: target.pid, windowId: target.window_id, app: safeStr(target.app_name, 60), title: safeStr(target.title, 80) },
    // 换算基准（2026-09-16 实测）：截图 = 窗口 bounds 的 1:1 物理像素裁剪
    // （同一窗口实测 bounds 1906×1166 == screenshot 1906×1166），故屏幕原点即 bounds.x/y。
    // 元素 frame 是屏幕物理像素，减 screenOrigin 后才是窗口截图坐标（computer_click 输入空间）。
    screenOrigin: screenOriginOf(target),
    // 实测（2026-09-16，可控探针窗口逐点标定，残差≤0.55px）：
    //   computer_click(x,y) 的坐标空间 = 窗口矩形相对物理像素（= 窗口截图空间）
    //   而驱动给的元素 frame 是**屏幕物理像素**（A6 复核：标题栏 y=806 而窗口原点 y=780）
    // 两者差一个窗口原点向量。mapElementsForModel() 负责换算；没有 bounds 时无法换算，
    // 必须如实标注 screen-physical-px，不能让模型把屏幕坐标直接喂给点击。
    coordinateSpace: screenOriginOf(target) ? 'window-screenshot-px' : 'screen-physical-px',
    elementCount,
    mode: effectiveMode,
    visualOnly,
    driverAccess: access,
    elements,
    screenshotFile,
    snapshotId: sid,
    changedSinceLast: changes ? changes.changed : null,
    changes: changes
      ? {
        changed: Boolean(changes.changed),
        titleChanged: Boolean(changes.titleChanged),
        added: changes.added || 0,
        removed: changes.removed || 0,
        changedCount: changes.changedCount || 0,
        summary: changes.summary || '',
      }
      : null,
    // image 仅在 native 模式存在；ax/vision 模式不得带 null（输出 schema 校验 image 为对象）
    ...(image ? { image } : {}),
  }
}

export async function screenObserve(ctx, args, cfg, exec) {
  const wantMode = args.mode
  const maxElements = args.maxElements || cfg.maxElements || 120
  // query 是只读过滤视图：驱动的 get_window_state 返回过滤树，并让旧 token 失效。
  // 不建立部分快照——否则菜单栏/保存按钮“缺失”会被后续动作当成不存在。
  const queryOnly = Boolean(args.query)

  // 1-2. 窗口列表 + 目标选择
  const picked = await pickObserveTarget(args)
  if (picked.overlay) {
    // 覆盖层不是用户窗口；不清旧快照，模型仍可回到刚才的目标。
    return {
      ok: false,
      result: `「${picked.want}」是插件的光标覆盖层${picked.title ? `（${picked.title}）` : ''}，不是可观察/可操作的应用窗口。`
        + '请选择实际应用窗口（pid/标题/window_id）重新观察。' + keptSnapshotNote(),
    }
  }
  if (picked.none) {
    clearSnapshot()
    return {
      ok: false,
      result: picked.onlyOverlay
        ? '当前只有插件的光标覆盖层，没有可操作的应用窗口。'
        : '当前没有可见窗口。',
    }
  }
  if (picked.notFound) {
    // 未找到的目标从未被驱动访问，旧快照的 token 仍然有效：不要为一个拼错的目标把它清掉。
    // 只有确实没有旧快照（或已过期）时才回到“无快照”。
    const keep = Boolean(getSnapshot()) && isFresh(cfg.ttlMs)
    if (!keep) clearSnapshot()
    const list = picked.candidates.length > 0 ? picked.candidates.join('\n') : '无'
    return {
      ok: false,
      result:
        `未找到指定窗口「${picked.want}」，未建立新快照。\n` +
        `当前可见窗口：\n${list}\n` +
        '请从上面选择 pid 或标题子串重新观察；不要依赖“自动回退到最前窗口”。'
        + (keep ? keptSnapshotNote() : ''),
    }
  }
  const { target, frontWindow, pickedFrontmost, matchCount = 1 } = picked

  // 3. AX 树（vision / native 模式同时抓截图）+ 桌面级降级短路
  const access = await driverAccess()
  const fetched = await fetchWindowTree(ctx, cfg, exec, target, { wantMode, maxElements, query: args.query, access })
  if (fetched.fallback) {
    // query 的 get_window_state 已经让旧 token 失效：只读视图不能保留旧快照。
    if (queryOnly) {
      clearSnapshot()
      return fetched.fallback
    }
    // 同窗口 get_window_state 失败可能已替换驱动 index map；不同窗口不影响旧快照。
    const kept = !sameSnapshotWindow(getSnapshot(), target)
    if (!kept) clearSnapshot()
    return kept ? { ...fetched.fallback, result: `${fetched.fallback.result}${keptSnapshotNote()}` } : fetched.fallback
  }
  const { state, rawElements } = fetched
  const elements = rawElements.filter(isActionable)

  // query 只读：不缓存过滤树，清掉旧 token 已失效的快照，后续动作会得到 [snapshot_missing]。
  if (queryOnly) clearSnapshot()

  // 4. 模式决策（native / vision / ax + 自动降级链）
  const degraded = Boolean(state.degraded_reason) || rawElements.length === 0
  const mode = await resolveObserveMode(ctx, cfg, exec, { state, target, wantMode, degraded })
  if (mode.fail) {
    if (queryOnly) {
      clearSnapshot()
      return mode.fail
    }
    const kept = !sameSnapshotWindow(getSnapshot(), target)
    if (!kept) clearSnapshot()
    return kept ? { ...mode.fail, result: `${mode.fail.result}${keptSnapshotNote()}` } : mode.fail
  }
  const { effectiveMode, visionText, image } = mode
  // 模型已看到同窗口的原生截图：允许它基于视觉核对继续（清除输入未确认门禁）。
  if (effectiveMode === 'native') clearInputUnconfirmed(target.pid, target.window_id)

  // 4.5 结构性密码标记（必须先于差分：差分不能把密码框的值显示出来）
  const { scan, scanNote } = await markStructuralPasswords(cfg, target, elements)

  // 4.6 状态差分（在密码标记之后；全量与降噪 stub 共用）
  // query 只读视图不更新差分基线，避免下一次全量观察出现“元素 +N”噪声。
  const changes = queryOnly ? null : diffObserve(target, rawElements)

  // 5. 快照缓存（element_token 自带的 snapshot_id 由引擎校验）
  // 降噪判定必须基于“本次观察替换快照之前”的消费状态（cacheSnapshot 会把 new snapshot 装上，
  // 之后 isConsumed() 恒为 false——2026-09-16 实测踩坑）
  const consumedBefore = queryOnly ? false : isConsumed()
  const suspectBefore = queryOnly ? false : Boolean(getSnapshot()?.suspect)
  if (!queryOnly) cacheSnapshot(cfg, target, state, elements, effectiveMode, scan, null, maxElements)

  // 6. 元素映射 → 文本渲染（文本必须与结构化 elements 用同一个点击空间，
  //    否则模型看到的是屏幕坐标、点击按窗口坐标解释，必然打偏——2026-11-14 t01 实测）
  const mappedElements = mapElementsForModel(target, elements)
  const lines = elements.map((e, i) => renderLine(e, mappedElements[i]))
  const { header, body, visionBlock } = renderObserveText({
    target, frontWindow, pickedFrontmost, matchCount, effectiveMode, degraded, wantMode, access, scanNote,
    state, lines, elements, changes, visionText, queryOnly,
  })
  const visualOnly = degraded
  const sid = queryOnly ? null : (state.snapshot_id ?? null)

  // 重复观察降噪：同一窗口、同一模式、界面未变且快照仍存活 → 回极简回执（省 token 与阅读成本）。
  // query 只读视图不读写 DEDUP_STATE。
  const stub = !queryOnly && mappedElements.length > 0
    ? dedupEvaluate(cfg, target, effectiveMode, args, mappedElements, sid, consumedBefore, elements, suspectBefore)
    : null
  if (stub) {
    const ambiguity = matchCount > 1
      ? `\n注意：目标匹配 ${matchCount} 个窗口，已取 z 序最前（pid=${target.pid} window_id=${target.window_id}）；多窗口请改用 window_id。`
      : ''
    const fgNote = foregroundHint(target, frontWindow, { short: true })
    const stubText = (changes && changes.changed !== null
      ? `${stub.text}\n自上次观察：${changes.summary}`
      : stub.text) + ambiguity + (fgNote ? `\n${fgNote}` : '')
    return observePayload({
      ok: true, result: stubText, target, access,
      elementCount: mappedElements.length, effectiveMode, visualOnly, sid,
      elements: stub.elements, screenshotFile: null, changes,
    })
  }

  return observePayload({
    ok: true,
    result: queryOnly
      ? `${header}\n${body}${visionBlock}\n\n提示: 本视图为 query 只读过滤结果，未建立动作快照；元素编号不能用于动作，from_zoom 也需要先全量观察。需要操作时请不带 query 重新 screen_observe。`
      : `${header}\n${body}${visionBlock}\n\n提示: 用 computer_click(element=[编号]) 或 computer_click(x=, y=) 操作（坐标为窗口截图原图像素，不是预览显示像素）。网格/画布像素定位先 screen_zoom（宽≤500），图内坐标必须 from_zoom=true。同一快照内可连续执行多个动作，无需每个动作前重新观察。`,
    target, access,
    elementCount: elements.length, effectiveMode, visualOnly, sid,
    elements: mappedElements,
    screenshotFile: state.screenshot_out_file || null,
    image, changes,
  })
}

/**
 * 从窗口标题/TabItem 判断“是否有未保存修改”。
 * true/false/null（无法判断）。只用于输入回执提示与 set_value 说明，不作为硬判据。
 */
function detectDirty(rawElements, title = '') {
  const t = String(title || '').trimStart()
  const tabs = (rawElements || []).filter((e) => /TabItem|AXTab/i.test(String(e?.role || '')))
  if (tabs.length > 0) {
    return tabs.some((e) => /已修改|modified|\*/.test(String(e?.label || e?.name || '')))
  }
  if (t) return t.startsWith('*')
  return null
}

/**
 * verifyAfterAction 的底层：对同一窗口抓一次无截图状态，计算差分并刷新 token。
 *
 * 关键约束：
 * - 结构性变化（元素增删）时清空快照，避免模型继续用旧编号点到别的控件；
 * - 只有值/标题变化时保留模型可见的 logical snapshot_id，但替换 entries 的
 *   element_token（驱动每次 get_window_state 都会让旧 token 失效）；
 * - 窗口消失/树为空 → 清快照，让下一次动作得到 snapshot_missing。
 * 这是 opt-in 的 (verifyAfterAction=auto)，默认不增加每个动作的 2s 成本。
 */
export async function refreshSnapshotState(cfg, pid, windowId) {
  const snap = getSnapshot()
  if (!snap || Number(snap.pid) !== Number(pid) || Number(snap.windowId) !== Number(windowId)) {
    return { ok: false, reason: '快照已变化，拒绝基于旧窗口复核' }
  }
  let state
  try {
    state = await cuaCall('get_window_state', {
      pid,
      window_id: windowId,
      include_screenshot: false,
      max_elements: snap.maxElements || cfg.maxElements || 120,
    })
  } catch (err) {
    clearSnapshot()
    return { ok: false, reason: `窗口不可用：${err.message}` }
  }
  const raw = Array.isArray(state?.elements) ? state.elements : []
  const elements = raw.filter(isActionable)
  const title = state?.window?.title || snap.title || ''
  const dirty = detectDirty(raw, title)
  if (raw.length === 0 || elements.length === 0) {
    clearSnapshot()
    return { ok: false, reason: raw.length === 0 ? '窗口 AX 树为空' : '窗口没有可交互元素', rawElements: raw, title, dirty }
  }
  const oldOrg = snap.screenOrigin
  const bounds = state.window?.bounds
    || (oldOrg ? { x: oldOrg.x, y: oldOrg.y, width: oldOrg.width ?? null, height: oldOrg.height ?? null } : null)
  const target = {
    pid,
    window_id: windowId,
    app_name: snap.appName || '',
    title: state.window?.title || snap.title || '',
    bounds,
  }
  const changes = diffObserve(target, raw)
  // 结构性变化不止增删：同编号 role 变化意味着驱动 index map 已重排/替换，
  // 继续用旧编号可能点到别的控件（verifyAfterAction 下尤其危险）。
  const roleChanged = elements.some((e) => {
    const old = snap.entries?.get(e.element_index)
    return Boolean(old) && String(old.role || '') !== String(e.role || '')
  })
  const structural = changes.added > 0 || changes.removed > 0 || roleChanged
  if (structural) {
    clearSnapshot()
    return { ok: true, changes, structural: true, rawElements: raw, title, dirty }
  }
  cacheSnapshot(cfg, target, state, elements, snap.mode || 'ax', null, snap.snapshotId, snap.maxElements)
  return { ok: true, changes, structural: false, rawElements: raw, title, dirty }
}

/** 阶段 1：zoom 目标解析（resolved pid / bounds / 尺寸）；窗口不存在或 pid 不匹配即失败。 */
async function resolveZoomTarget(ctx, cfg, exec, args) {
  const winList = await cuaCall('list_windows', { on_screen_only: true })
  rememberWindows(winList.windows || [])
  const hit = (winList.windows || []).find((w) => Number(w.window_id) === Number(args.window_id))
  if (!hit) {
    return { fail: { ok: false, result: `window_id ${args.window_id} 不在当前可见窗口列表中；请先 screen_observe 取得有效 window_id。` } }
  }
  if (isAgentOverlayWindow(hit)) {
    return { fail: { ok: false, result: `window_id ${args.window_id} 是插件光标覆盖层（${safeStr(hit.title || '', 60)}），不能作为截图目标。` } }
  }
  const hitPid = Number(hit.pid)
  if (args.pid !== undefined && args.pid !== null && args.pid !== ''
    && Number(args.pid) !== hitPid) {
    return { fail: { ok: false, result: `pid ${args.pid} 与 window_id ${args.window_id} 的实际 pid ${hitPid} 不一致；拒绝截图。` } }
  }
  const pid = hitPid
  if (!Number.isFinite(pid) || pid <= 0) {
    return { fail: { ok: false, result: `window_id ${args.window_id} 没有有效 pid；拒绝截图。` } }
  }
  const zoomTarget = hit

  const access = await driverAccess()
  // 几何优先取当前快照的截图尺寸（同一 window 时最准确；避免为了尺寸再调
  // get_window_state——它会替换驱动 index map，让快照 token 失效）。
  const snap = getSnapshot()
  let size = null
  if (snap && Number(snap.pid) === pid && Number(snap.windowId) === Number(args.window_id)
    && snap.screenshotWidth && snap.screenshotHeight) {
    size = { screenshot_width: snap.screenshotWidth, screenshot_height: snap.screenshotHeight }
  } else if (zoomTarget?.bounds?.width && zoomTarget?.bounds?.height) {
    size = { screenshot_width: zoomTarget.bounds.width, screenshot_height: zoomTarget.bounds.height }
  } else {
    size = await observeWindowState(ctx, cfg, exec, { pid, window_id: args.window_id }, {
      pid,
      window_id: args.window_id,
      include_screenshot: true,
      max_elements: 1,
    }, access)
  }
  if (size && size.__desktopFallback) return { fallback: size.__desktopFallback }
  return { pid, zoomTarget, access, size }
}

/** 阶段 2：裁剪矩形钳制到窗口截图范围（请求区域；真实图像含驱动 padding，由 from_zoom 映射）。 */
function clampZoomCrop(size, args) {
  const w = size?.screenshot_width || 1
  const h = size?.screenshot_height || 1
  const x1 = args.x1 ?? 0
  const y1 = args.y1 ?? 0
  const x2 = args.x2 ?? w
  const y2 = args.y2 ?? h
  const cx1 = Math.max(0, Number(x1) || 0)
  const cy1 = Math.max(0, Number(y1) || 0)
  const cx2 = Math.max(cx1 + 1, Math.min(w, Number(x2) || w))
  const cy2 = Math.max(cy1 + 1, Math.min(h, Number(y2) || h))
  return { cx1, cy1, cx2, cy2, cropW: cx2 - cx1, cropH: cy2 - cy1 }
}

/** 阶段 3b：zoom 失败但整窗截图已到手 → 回退整窗原生直读；无图可退返回 null（调用方重抛原错）。 */
async function zoomFullWindowFallback(attachments, size, { w, h, windowId, access, err }) {
  if (!size?.screenshot_png_b64) return null
  try {
    const image = await saveImageAttachment(attachments, {
      data: buf(size.screenshot_png_b64),
      mediaType: size.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      name: `screen-${windowId}-full.png`,
    }, { width: w, height: h })
    return {
      ok: true,
      result: `zoom 失败（${err.message}），已回退整窗截图直读（${image.width ?? w}×${image.height ?? h}px）。`
        + '本图坐标=窗口截图原图像素，可直接 computer_click(x=,y=)，不要加 from_zoom；整窗图可能被预览缩放，像素定位优先重新 screen_zoom 裁剪。' + accessNote(access),
      crop: { x: 0, y: 0, w, h },
      fromZoom: false,
      image,
      coordinateSpace: 'window-screenshot-px',
    }
  } catch {
    return null
  }
}

/**
 * screen_zoom —— 区域截图工具：裁剪窗口某区域（≤500px 宽 JPEG）直读。
 * 两种用法：①"放大某块区域细看"（小字、图标、图表）；
 * ②**定位原语**（树空/像素目标的定位环）：在图内语义确认目标，然后把图内坐标
 *   直接交给 computer_click(x=,y=,from_zoom=true)；驱动会按 padding/缩放换算回
 *   窗口截图坐标。插件不再用请求 crop 手算 scale——驱动 0.23.2 会加 20% padding
 *   并可能缩放，手算必然偏移。
 * @param {object} ctx
 * @param {object} args - { pid?, window_id, x1, y1, x2, y2 }
 */
export async function screenZoom(ctx, args, cfg, exec) {
  const capable = await routeImageCapable(ctx, exec)
  if (!capable) {
    return { ok: false, result: 'screen_zoom 需要当前对话模型支持图片输入（原生直读），请使用视觉模型（如 deepseek-flash）。' }
  }

  // 1. 目标解析（resolved pid / 屏幕原点 / 窗口尺寸）
  const resolved = await resolveZoomTarget(ctx, cfg, exec, args)
  if (resolved.fail) return resolved.fail
  if (resolved.fallback) return resolved.fallback
  const { pid, zoomTarget, access, size } = resolved

  // 2. 裁剪矩形 + 驱动硬上限（0.23.2：请求区域宽 ≤500px）
  const { cx1, cy1, cx2, cy2, cropW, cropH } = clampZoomCrop(size, args)
  const w = size.screenshot_width || 1
  const h = size.screenshot_height || 1
  if (cropW > 500) {
    return {
      ok: false,
      result: `请求区域宽 ${cropW}px > 500px（cua-driver zoom 上限）。请把 x2-x1 缩到 ≤500，或分块截图；不要重复同一请求。`,
    }
  }

  const attachments = ctx?.get?.('attachments')
  if (!attachments) return { ok: false, result: '当前环境未挂载 attachments 服务。' }

  // 3. 区域截图（失败但有整窗截图 → 回退整窗直读）
  // 新 zoom 失败后，旧 from_zoom 映射不再可信：先清掉该 pid 的 lastZoom。
  clearZoom(pid)
  let zv
  try {
    zv = await cuaCall('zoom', withSession({
      pid,
      window_id: args.window_id,
      x1: cx1,
      y1: cy1,
      x2: cx2,
      y2: cy2,
    }))
  } catch (err) {
    const fb = await zoomFullWindowFallback(attachments, size, { w, h, windowId: args.window_id, access, err })
    if (fb) {
      clearInputUnconfirmed(pid, args.window_id)
      return fb
    }
    throw err
  }

  // 4. 提交图片。返回图包含驱动自动加的 padding，且可能被缩放；真实映射由驱动
  //    的 from_zoom 完成，插件不再计算 cropW/imgW 之类的手工比例。
  const jpeg = buf(zv?.screenshot_png_b64)
  if (jpeg.byteLength === 0) return { ok: false, result: 'zoom 返回空图片。' }
  const image = await saveImageAttachment(attachments, {
    data: jpeg,
    mediaType: 'image/jpeg',
    name: `screen-zoom-${args.window_id}.jpg`,
  }, { width: zv?.width, height: zv?.height })
  const imgW = Number(zv?.width) || Number(image.width) || cropW
  const imgH = Number(zv?.height) || Number(image.height) || cropH
  noteZoom(pid, args.window_id, { imageW: imgW, imageH: imgH })
  clearInputUnconfirmed(pid, args.window_id)
  return {
    ok: true,
    result: `区域截图完成（${imgW}×${imgH}px JPEG；请求区域 (${cx1},${cy1}) ${cropW}×${cropH}）。`
      + '本图坐标空间=zoom-image-px：定位时直接把图内坐标传给 computer_click(x=,y=, from_zoom=true)，'
      + '由驱动换算回窗口截图坐标。驱动会自动加 20% padding 并可能缩放，因此不要用 crop 自己算比例；'
      + `screenOrigin ${(() => { const o = screenOriginOf(zoomTarget); return o ? `(${o.x},${o.y})` : '(未知)' })()} 只用于屏幕绝对坐标，不是点击输入。`,
    crop: { x: cx1, y: cy1, w: cropW, h: cropH },
    fromZoom: true,
    screenOrigin: screenOriginOf(zoomTarget),
    coordinateSpace: 'zoom-image-px',
    image,
  }
}
