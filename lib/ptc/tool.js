/**
 * tool.js —— PTC 的 computer_cua 工具实现。
 *
 * 设计：
 *   - 只做协议映射、应用/窗口解析、快照绑定与结果整形；
 *   - 所有输入动作都通过 defsRef().get(...).execute(...) 调现有工具，继承
 *     guard / policy / stop / 重复抑制 / Windows 投递阶梯；
 *   - 缺口方法不近似：返回 CAPABILITY_UNAVAILABLE，带原因与替代路径。
 */
import { cuaCall, cuaDriverCapabilities } from '../cua.js'
import { captureWindowBytes, driverAccess } from '../observe.js'
import { getSnapshot, isFresh, relativeFrame, relativeToPixels } from '../snapshot.js'
import { evaluatePolicy, resolvePolicyDecision } from '../policy.js'
import { logPtcCall, logPolicyDecision } from '../trajectory.js'
import { showWindow, scrollAt } from './native.js'
import {
  CORE_METHODS, METHOD_NAMES, METHOD_SUPPORT, APP_HANDLE_PREFIX,
  PtcError, capabilityUnavailable, makeAppHandle,
  optionUnavailable, parseAppHandle, parseElementId, receiptToPtcError,
  validateRequest,
} from './protocol.js'

const APP_LAUNCH_WAIT_MS = 5000
const APP_LAUNCH_POLL_MS = 250

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function appNameOf(w) {
  return String(w?.app_name || w?.app || '')
}

function boundsOf(w) {
  const b = w?.bounds
  if (b && typeof b === 'object' && Number(b.width) > 0 && Number(b.height) > 0) {
    return { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) }
  }
  if (Number(w?.width) > 0 && Number(w?.height) > 0) {
    return { x: Number(w.x), y: Number(w.y), width: Number(w.width), height: Number(w.height) }
  }
  return null
}

function windowRecord(w, fallbackAppName = '') {
  const bounds = boundsOf(w)
  if (!bounds) return null
  const windowId = Number(w.window_id ?? w.windowId)
  if (!Number.isInteger(windowId) || windowId <= 0) return null
  return {
    windowId,
    appName: appNameOf(w) || fallbackAppName,
    title: String(w.title || ''),
    bounds,
    isOnScreen: w.is_on_screen !== false,
    onCurrentSpace: null,
    minimized: Boolean(w.minimized),
    zIndex: Number.isFinite(Number(w.z_index)) ? Number(w.z_index) : 0,
  }
}

function publicWindow(record) {
  return {
    windowId: record.windowId,
    appName: record.appName,
    title: record.title,
    bounds: record.bounds,
    isOnScreen: record.isOnScreen,
    onCurrentSpace: null,
  }
}

function mapModifiers(modifiers, method) {
  const out = []
  for (const raw of modifiers || []) {
    const key = String(raw).toLowerCase()
    const mapped = key === 'control' ? 'ctrl' : key === 'option' ? 'alt' : key
    if (mapped === 'command' || mapped === 'fn') {
      throw optionUnavailable(method, 'modifiers', `Windows 不支持 ${raw} 修饰键`, ['ctrl', 'shift', 'alt'])
    }
    if (!['ctrl', 'shift', 'alt', 'win'].includes(mapped)) {
      throw optionUnavailable(method, 'modifiers', `不支持的修饰键 ${raw}`, ['ctrl', 'shift', 'alt'])
    }
    if (!out.includes(mapped)) out.push(mapped)
  }
  return out
}

function normalizeActionName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 驱动 action 名与官方 pattern 名的归一：set_value 与 ValuePattern.SetValue 等价。 */
const ACTION_ALIASES = Object.freeze({
  invoke: 'invoke',
  invokepatterninvoke: 'invoke',
  setvalue: 'setvalue',
  valuepatternsetvalue: 'setvalue',
})

function canonicalActionName(value) {
  const n = normalizeActionName(value)
  return ACTION_ALIASES[n] || n
}

/**
 * @param {{cfg:object, ctx:object, defsRef:()=>Map<string,object>, wrap:Function}} deps
 * @returns {object} 原始工具定义（由 index.js 的 defineTool 包装）
 */
export function createCuaToolDef({ cfg, ctx, defsRef, wrap }) {
  async function callInner(name, args, exec) {
    const def = defsRef().get(name)
    if (!def) throw new PtcError('CAPABILITY_UNAVAILABLE', `内层工具 ${name} 不可用`, { tool: name })
    const result = await def.execute(args, exec)
    if (!result || result.ok !== true) throw receiptToPtcError(result?.result || `${name} 执行失败`)
    return result
  }

  async function listWindowsFor(pid, appName = '') {
    const value = await cuaCall('list_windows', { pid })
    const rows = Array.isArray(value) ? value : (value?.windows || value?._legacy_windows || [])
    return (Array.isArray(rows) ? rows : [])
      .map((w) => windowRecord(w, appName))
      .filter(Boolean)
  }

  function chooseWindow(records, windowId) {
    if (windowId !== undefined) {
      const found = records.find((w) => w.windowId === Number(windowId))
      if (!found) {
        throw new PtcError('WINDOW_NOT_FOUND', `windowId=${windowId} 不属于当前应用或已关闭`, { windowId })
      }
      return found
    }
    const visible = records.filter((w) => w.isOnScreen && !w.minimized)
      .sort((a, b) => b.zIndex - a.zIndex)
    const picked = visible[0] || records[0]
    if (!picked) throw new PtcError('WINDOW_NOT_FOUND', '应用当前没有可用窗口', {})
    return picked
  }

  function chooseShowWindow(records, windowId) {
    if (windowId !== undefined) return chooseWindow(records, windowId)
    const minimized = records.find((w) => w.minimized)
    if (minimized) return minimized
    return chooseWindow(records)
  }

  /**
   * 直接 native 动作没有内层工具包装；用同一 policy 引擎补授权。
   * show 套 computer_activate 的应用规则；scroll 套 computer_scroll 的应用规则。
   */
  async function authorizeNative(tool, app, args, exec) {
    const origin = exec?.agent?.session?.header?.origin || 'main'
    const decision = evaluatePolicy(cfg, {
      tool,
      args,
      snapshot: { appName: app.name, pid: app.pid },
      origin,
    })
    if (decision) logPolicyDecision({ tool, origin, ...decision })
    if (decision?.decision === 'deny') {
      throw new PtcError('POLICY_DENIED', decision.reason, { rule: decision.rule, code: decision.code })
    }
    if (decision?.decision === 'ask') {
      const approved = await resolvePolicyDecision(ctx, exec, decision)
      if (!approved.ok) {
        throw new PtcError(approved.code ? String(approved.code).toUpperCase() : 'APPROVAL_DENIED',
          approved.reason, { rule: decision.rule, code: approved.code })
      }
    }
  }

  async function appRecord(pid) {
    const value = await cuaCall('list_apps')
    const apps = Array.isArray(value?.apps) ? value.apps : []
    return apps.find((a) => Number(a.pid) === Number(pid) && a.running !== false) || null
  }

  async function listAllApps() {
    const value = await cuaCall('list_apps')
    return Array.isArray(value?.apps) ? value.apps : []
  }

  function normalizeApp(a) {
    return {
      name: String(a.name || a.app_name || ''),
      pid: Number(a.pid) || 0,
      running: a.running !== false && Number(a.pid) > 0,
      bundleId: typeof a.bundle_id === 'string' && a.bundle_id ? a.bundle_id : undefined,
      launchPath: typeof a.launch_path === 'string' && a.launch_path ? a.launch_path : undefined,
    }
  }

  async function resolveApp(selector) {
    const apps = (await listAllApps()).map(normalizeApp)
    const text = String(selector)
    if (/^\d+$/.test(text)) {
      const pid = Number(text)
      const running = apps.find((a) => a.running && a.pid === pid)
      if (running) return running
      throw new PtcError('APP_NOT_FOUND', `没有运行中的 pid=${pid}`, { selector })
    }
    const matches = apps.filter((a) => a.name.toLowerCase() === text.toLowerCase()
      || a.bundleId === text || a.launchPath === text)
    const running = matches.filter((a) => a.running)
    if (running.length === 1) return running[0]
    if (running.length > 1) {
      throw new PtcError('APP_AMBIGUOUS', `应用名 "${text}" 匹配多个运行实例；请用 pid 选择`, {
        selector, candidates: running.map((a) => ({ pid: a.pid, name: a.name })),
      })
    }
    const installed = matches.filter((a) => !a.running)
    if (installed.length === 1) return installed[0]
    if (installed.length > 1) {
      throw new PtcError('APP_AMBIGUOUS', `应用 "${text}" 匹配多个安装项；请用完整路径选择`, {
        selector, candidates: installed.map((a) => ({ name: a.name, path: a.launchPath || a.bundleId })),
      })
    }
    throw new PtcError('APP_NOT_FOUND', `未找到应用 "${text}"`, { selector })
  }

  async function launchAppRecord(app, exec) {
    const args = app.launchPath || app.bundleId
      ? { bundle_id: app.launchPath || app.bundleId }
      : { name: app.name }
    const launched = await callInner('app_launch', args, exec)
    let pid = Number(launched.pid) || 0
    if (!pid) {
      const deadline = Date.now() + APP_LAUNCH_WAIT_MS
      while (!pid && Date.now() < deadline) {
        await sleep(APP_LAUNCH_POLL_MS)
        const found = (await listAllApps()).map(normalizeApp)
          .find((a) => a.running && a.name.toLowerCase() === app.name.toLowerCase())
        pid = found?.pid || 0
      }
    }
    if (!pid) {
      throw new PtcError('APP_LAUNCH_FAILED', `应用 "${app.name}" 启动后未获得 pid`, { app: app.name, receipt: launched.result })
    }
    return pid
  }

  function snapshotWindow(pid, windowId) {
    const snap = getSnapshot()
    if (!snap || !isFresh(cfg.ttlMs) || Number(snap.pid) !== Number(pid) || Number(snap.windowId) !== Number(windowId)) {
      return null
    }
    return snap
  }

  async function ensureSnapshot(pid, windowId, exec, maxElements = undefined) {
    const existing = snapshotWindow(pid, windowId)
    if (existing) return existing
    await callInner('screen_observe', {
      window_id: windowId,
      force: true,
      ...(maxElements === undefined ? {} : { maxElements }),
    }, exec)
    const snap = snapshotWindow(pid, windowId)
    if (!snap?.snapshotId) {
      throw new PtcError('OBSERVE_REQUIRED', '观察没有建立有效快照；请重新 getAccessibilityTree()', { pid, windowId })
    }
    return snap
  }

  function currentSnapshotOrThrow() {
    const snap = getSnapshot()
    if (!snap || !isFresh(cfg.ttlMs)) {
      throw new PtcError('OBSERVE_REQUIRED', '需要先 getAccessibilityTree() 建立快照', {})
    }
    if (!snap.snapshotId) {
      throw new PtcError('OBSERVE_REQUIRED', '当前快照没有 snapshotId；请重新 getAccessibilityTree()', {})
    }
    return snap
  }

  function elementTarget(params, snap, method) {
    const parsed = parseElementId(params.elementId, method)
    if (parsed.snapshotId !== String(params.snapshotId)) {
      throw new PtcError('STALE_SNAPSHOT', `${method} 的 elementId 不属于 snapshotId=${params.snapshotId}`, {
        method, snapshotId: params.snapshotId, elementId: params.elementId,
      })
    }
    const entry = snap.entries?.get(parsed.index)
    if (!entry) {
      throw new PtcError('STALE_SNAPSHOT', `${method} 的元素 ${params.elementId} 不在当前快照中`, {
        method, elementId: params.elementId,
      })
    }
    return { index: parsed.index, entry, snapshotId: parsed.snapshotId }
  }

  async function capabilities() {
    const access = await driverAccess()
    const driver = await cuaDriverCapabilities().catch(() => null)
    return {
      platform: process.platform,
      permissions: {
        accessibility: access ? Boolean(access.uia) : true,
        screenRecording: true,
      },
      appLevelAccessibility: false,
      systemPointer: false,
      keyboard: ['window'],
      sessionLocked: null,
      methods: [...CORE_METHODS],
      coordinateSpace: 'screenshot-pixels',
      browser: false,
      // 非官方扩展：PTC facade 用它解释缺口；官方 bridge 解析时会忽略。
      methodSupport: METHOD_SUPPORT,
      driver: driver ? {
        profile: driver.profile ?? null,
        frameSpace: driver.frameSpace ?? null,
        pointerCapture: Boolean(driver.pointerCapture),
        moveCursorScreen: Boolean(driver.moveCursorScreen),
      } : null,
    }
  }

  async function listApps() {
    return (await listAllApps())
      .map(normalizeApp)
      .filter((a) => a.running)
      .map((a) => ({ pid: a.pid, name: a.name, ...(a.bundleId ? { bundleId: a.bundleId } : {}) }))
  }

  async function findApps(query) {
    const q = String(query).toLowerCase()
    const out = []
    for (const raw of await listAllApps()) {
      const app = normalizeApp(raw)
      const hay = `${app.name}\n${app.bundleId || ''}\n${app.launchPath || ''}`.toLowerCase()
      if (!hay.includes(q)) continue
      const path = app.launchPath || app.bundleId || app.name
      out.push({
        id: app.bundleId || app.launchPath || (app.running ? `pid:${app.pid}` : app.name),
        displayName: app.name,
        path,
        isRunning: app.running,
        ...(app.running ? { pid: app.pid } : {}),
      })
    }
    return out
  }

  async function getApp(selector, exec) {
    const app = await resolveApp(selector)
    let pid = app.pid
    if (!app.running) pid = await launchAppRecord(app, exec)
    const record = await appRecord(pid)
    return {
      appHandle: makeAppHandle(pid),
      name: record?.name || app.name,
      ...(record?.bundle_id || app.bundleId ? { bundleId: record?.bundle_id || app.bundleId } : {}),
      running: true,
    }
  }

  async function listWindows(pid, appName) {
    return (await listWindowsFor(pid, appName)).map(publicWindow)
  }

  async function appInfoFor(pid) {
    const app = await appRecord(pid)
    if (!app) throw new PtcError('APP_NOT_FOUND', `pid=${pid} 已不再运行`, { pid })
    return normalizeApp(app)
  }

  async function getState(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'getState')
    const app = await appInfoFor(pid)
    if (params.maxDepth !== undefined) {
      throw optionUnavailable('getState', 'maxDepth', '当前 screen_observe 不支持 maxDepth', ['maxElements'])
    }
    if (params.includeMenus === true) {
      throw optionUnavailable('getState', 'includeMenus', '当前观察树不单独展开菜单内容', ['用 computer_menu 按路径操作'])
    }
    if (params.details === true) {
      throw optionUnavailable('getState', 'details', '当前观察输出不包含 automationId/完整 bounds/全部 action 名', ['listActions()'])
    }
    const records = await listWindowsFor(pid, app.name)
    const picked = chooseWindow(records, params.windowId)
    const maxElements = params.maxElements ?? cfg.maxElements ?? 120
    const observed = await callInner('screen_observe', {
      window_id: picked.windowId,
      force: true,
      maxElements,
    }, exec)
    if (!observed.snapshotId) {
      throw new PtcError('OBSERVE_REQUIRED', '观察没有建立 snapshotId；请重新 getAccessibilityTree()', { pid, windowId: picked.windowId })
    }
    return {
      appHandle: params.appHandle,
      windowId: picked.windowId,
      snapshotId: String(observed.snapshotId),
      tree: String(observed.result || ''),
      windows: records.map(publicWindow),
      truncated: Number(observed.elementCount) >= Number(maxElements),
    }
  }

  async function listActions(params) {
    const pid = parseAppHandle(params.appHandle, 'listActions')
    const snap = currentSnapshotOrThrow()
    if (Number(snap.pid) !== pid) {
      throw new PtcError('STALE_SNAPSHOT', '当前快照属于另一个应用；请重新 getAccessibilityTree()', { pid })
    }
    const target = elementTarget(params, snap, 'listActions')
    return [...(target.entry.actions || [])]
  }

  async function invoke(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'invoke')
    const snap = currentSnapshotOrThrow()
    if (Number(snap.pid) !== pid) {
      throw new PtcError('STALE_SNAPSHOT', '当前快照属于另一个应用；请重新 getAccessibilityTree()', { pid })
    }
    const target = elementTarget(params, snap, 'invoke')
    await callInner('computer_click', {
      element: target.index,
      snapshot_id: target.snapshotId,
    }, exec)
    return { dispatched: true }
  }

  async function setValue(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'setValue')
    const snap = currentSnapshotOrThrow()
    if (Number(snap.pid) !== pid) {
      throw new PtcError('STALE_SNAPSHOT', '当前快照属于另一个应用；请重新 getAccessibilityTree()', { pid })
    }
    const target = elementTarget(params, snap, 'setValue')
    await callInner('computer_set_value', {
      element: target.index,
      value: String(params.value),
      snapshot_id: target.snapshotId,
    }, exec)
    return { dispatched: true }
  }

  async function typeText(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'typeText')
    const app = await appInfoFor(pid)
    const records = await listWindowsFor(pid, app.name)
    const picked = chooseWindow(records, params.windowId)
    const snap = await ensureSnapshot(pid, picked.windowId, exec)
    await callInner('computer_type', {
      text: params.text,
      snapshot_id: snap.snapshotId,
    }, exec)
    return { dispatched: true }
  }

  async function pressKey(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'pressKey')
    const app = await appInfoFor(pid)
    const records = await listWindowsFor(pid, app.name)
    const picked = chooseWindow(records, params.windowId)
    const snap = await ensureSnapshot(pid, picked.windowId, exec)
    const modifiers = mapModifiers(params.modifiers, 'pressKey')
    const key = modifiers.length > 0
      ? `${modifiers.join('+')}+${String(params.key)}`
      : String(params.key)
    await callInner('computer_key', {
      key,
      snapshot_id: snap.snapshotId,
    }, exec)
    return { dispatched: true }
  }

  async function mouseMove(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'mouseMove')
    if (params.useSystemPointer === true) {
      throw optionUnavailable('mouseMove', 'useSystemPointer',
        'PTC 桥接不暴露真实指针；请用 computer_hover(real=true) + autonomy.realPointer 策略',
        ['computer_do({action:"call",tool:"computer_hover",args:{real:true}}）'])
    }
    if (params.elementId !== undefined) {
      const snap = currentSnapshotOrThrow()
      if (Number(snap.pid) !== pid) {
        throw new PtcError('STALE_SNAPSHOT', '当前快照属于另一个应用；请重新 getAccessibilityTree()', { pid })
      }
      if (!params.snapshotId) throw new PtcError('INVALID_ARGUMENT', 'mouseMove 使用 elementId 时需要 snapshotId', {})
      const target = elementTarget(params, snap, 'mouseMove')
      if (target.entry.x === null || target.entry.y === null) {
        throw new PtcError('CAPABILITY_UNAVAILABLE', '该元素没有可用中心坐标', { elementId: params.elementId })
      }
      await callInner('computer_hover', {
        pid,
        window_id: snap.windowId,
        x: target.entry.x,
        y: target.entry.y,
      }, exec)
      return { dispatched: true, hoverRoute: 'accessibility', systemPointerMoved: false }
    }
    const app = await appInfoFor(pid)
    const records = await listWindowsFor(pid, app.name)
    const picked = chooseWindow(records, params.windowId)
    await ensureSnapshot(pid, picked.windowId, exec)
    await callInner('computer_hover', {
      pid,
      window_id: picked.windowId,
      x: params.x,
      y: params.y,
      ...(params.relative === undefined ? {} : { relative: params.relative }),
    }, exec)
    return { dispatched: true, hoverRoute: 'accessibility', systemPointerMoved: false }
  }

  async function click(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'click')
    if (params.holdMs !== undefined && params.holdMs > 0) {
      throw optionUnavailable('click', 'holdMs', '当前 click 不提供按住时长；按住由 driver 的显式 hold 参数控制，尚未接线', ['普通 click'])
    }
    const button = params.mouseButton || 'left'
    const count = params.clickCount || 1
    if (button === 'middle') {
      throw optionUnavailable('click', 'mouseButton', 'middle click 没有现有工具路径', ['left/right'])
    }
    if (button === 'right' && count !== 1) {
      throw optionUnavailable('click', 'clickCount', '右键只支持单次', ['left + clickCount:2'])
    }
    const modifiers = mapModifiers(params.modifiers, 'click')
    let args
    if (params.elementId !== undefined) {
      const snap = currentSnapshotOrThrow()
      if (Number(snap.pid) !== pid) {
        throw new PtcError('STALE_SNAPSHOT', '当前快照属于另一个应用；请重新 getAccessibilityTree()', { pid })
      }
      if (!params.snapshotId) throw new PtcError('INVALID_ARGUMENT', 'click 使用 elementId 时需要 snapshotId', {})
      const target = elementTarget(params, snap, 'click')
      args = {
        element: target.index,
        snapshot_id: target.snapshotId,
        ...(modifiers.length ? { modifier: modifiers } : {}),
      }
    } else {
      const app = await appInfoFor(pid)
      const records = await listWindowsFor(pid, app.name)
      const picked = chooseWindow(records, params.windowId)
      const snap = await ensureSnapshot(pid, picked.windowId, exec)
      args = {
        x: params.x,
        y: params.y,
        snapshot_id: snap.snapshotId,
        ...(params.relative === undefined ? {} : { relative: params.relative }),
        ...(modifiers.length ? { modifier: modifiers } : {}),
      }
    }
    const tool = button === 'right'
      ? 'computer_right_click'
      : count === 2 ? 'computer_double_click' : 'computer_click'
    await callInner(tool, args, exec)
    return { dispatched: true }
  }

  async function drag(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'drag')
    const app = await appInfoFor(pid)
    const records = await listWindowsFor(pid, app.name)
    const picked = chooseWindow(records, params.windowId)
    const snap = await ensureSnapshot(pid, picked.windowId, exec)
    const modifiers = mapModifiers(params.modifiers, 'drag')
    await callInner('computer_drag', {
      from_x: params.fromX,
      from_y: params.fromY,
      to_x: params.toX,
      to_y: params.toY,
      snapshot_id: snap.snapshotId,
      ...(params.mouseButton ? { button: params.mouseButton } : {}),
      ...(params.relative === undefined ? {} : { relative: params.relative }),
      ...(modifiers.length ? { modifier: modifiers } : {}),
    }, exec)
    return { dispatched: true }
  }

  async function show(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'show')
    const app = await appInfoFor(pid)
    const records = await listWindowsFor(pid, app.name)
    const picked = chooseShowWindow(records, params.windowId)
    await authorizeNative('computer_activate', app, { pid }, exec)
    const result = await showWindow({ pid, hwnd: picked.windowId })
    if (!result?.ok) {
      const code = String(result?.code || '')
      if (code === 'window_not_found') {
        throw new PtcError('WINDOW_NOT_FOUND', `windowId=${picked.windowId} 已关闭`, { windowId: picked.windowId })
      }
      if (code === 'uipi' || code === 'secure_desktop' || code === 'unavailable') {
        throw new PtcError('CAPABILITY_UNAVAILABLE', `show 不可用：${result.error || code}`, {
          method: 'show', code, alternatives: ['activate()', 'computer_activate'],
        })
      }
      throw new PtcError('OPERATION_FAILED', result.error || 'show 失败', { code })
    }
    return {
      dispatched: result.dispatched !== false,
      windowId: picked.windowId,
      foregroundChanged: Boolean(result.foregroundChanged),
      ...(result.effect === undefined ? {} : { effect: result.effect }),
      ...(result.warning_code === undefined ? {} : { warningCode: result.warning_code }),
    }
  }

  async function scroll(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'scroll')
    const deltaX = Number(params.deltaLinesX) || 0
    const deltaY = Number(params.deltaLinesY) || 0
    if (deltaX === 0 && deltaY === 0) {
      throw new PtcError('INVALID_ARGUMENT', 'scroll 需要至少一个非零 delta', { method: 'scroll' })
    }
    const app = await appInfoFor(pid)
    const records = await listWindowsFor(pid, app.name)
    const picked = chooseWindow(records, params.windowId)
    const snap = await ensureSnapshot(pid, picked.windowId, exec)
    if (!snap.screenOrigin) {
      throw new PtcError('CAPABILITY_UNAVAILABLE', '当前快照没有窗口原点，无法把窗口坐标映射到屏幕点', {
        method: 'scroll', status: 'diagnostic',
        alternatives: ['computer_scroll(direction,amount)', 'click(element) 后 computer_scroll'],
      })
    }
    let x = Number(params.x)
    let y = Number(params.y)
    if (params.relative === true) {
      try {
        const frame = relativeFrame(snap)
        x = relativeToPixels(params.x, frame.width, 'x')
        y = relativeToPixels(params.y, frame.height, 'y')
      } catch (err) {
        const message = err?.message || 'relative 坐标无法换算'
        if (/\[relative_coordinate_unavailable\]/.test(message)) {
          throw new PtcError('STALE_SNAPSHOT', message, { method: 'scroll' })
        }
        throw new PtcError('INVALID_ARGUMENT', message, { method: 'scroll' })
      }
    }
    const width = Number(snap.screenshotWidth) || Number(snap.screenOrigin.width) || 0
    const height = Number(snap.screenshotHeight) || Number(snap.screenOrigin.height) || 0
    if (x < 0 || y < 0 || (width > 0 && x >= width) || (height > 0 && y >= height)) {
      throw new PtcError('INVALID_ARGUMENT', `scroll 坐标 (${x},${y}) 超出窗口截图范围`, {
        method: 'scroll', width, height,
      })
    }
    const screenX = Math.round(Number(snap.screenOrigin.x) + x)
    const screenY = Math.round(Number(snap.screenOrigin.y) + y)
    await authorizeNative('computer_scroll', app, {
      x, y, relative: params.relative === true, direction: deltaY < 0 ? 'down' : 'up',
    }, exec)
    const result = await scrollAt({
      pid,
      hwnd: picked.windowId,
      screenX,
      screenY,
      deltaX,
      deltaY,
    })
    if (!result?.ok) {
      const code = String(result?.code || '')
      if (code === 'no_scroll_pattern' || code === 'no_scroll_pattern_in_subtree'
        || code === 'not_scrollable' || code === 'point_not_in_target' || code === 'no_element') {
        throw new PtcError('CAPABILITY_UNAVAILABLE', `点 (${screenX},${screenY}) 没有可滚动的 UIA ScrollPattern`, {
          method: 'scroll', code,
          diagnostics: result.diagnostics,
          alternatives: ['computer_scroll(direction,amount)', 'pressKey("pagedown")', '点击滚动条'],
        })
      }
      if (code === 'window_not_found') {
        throw new PtcError('WINDOW_NOT_FOUND', `windowId=${picked.windowId} 已关闭`, { windowId: picked.windowId })
      }
      if (code === 'pid_mismatch') {
        throw new PtcError('INVALID_ARGUMENT', 'scroll 目标 pid 与窗口不匹配', { method: 'scroll' })
      }
      if (code === 'timeout') {
        throw new PtcError('OPERATION_TIMEOUT', result.error || 'UIA scroll 超时', { method: 'scroll' })
      }
      if (code === 'scroll_no_effect') {
        throw new PtcError('OPERATION_FAILED', `${result.error || 'UIA scroll 没有产生可见移动'} [scroll_no_effect]`, {
          method: 'scroll', code,
          moved: false,
          axisMoved: result.axisMoved,
          percentBefore: result.percentBefore,
          percentAfter: result.percentAfter,
          diagnostics: result.diagnostics,
        })
      }
      if (code === 'scroll_partial') {
        throw new PtcError('OPERATION_FAILED', `${result.error || 'UIA scroll 部分执行'} [scroll_partial]`, {
          method: 'scroll', code,
          scrolled: Number(result.scrolled) || 0,
          moved: result.moved,
          axisMoved: result.axisMoved,
          percentBefore: result.percentBefore,
          percentAfter: result.percentAfter,
          diagnostics: result.diagnostics,
        })
      }
      if (code === 'unavailable') {
        throw new PtcError('CAPABILITY_UNAVAILABLE', result.error || 'UIA scroll helper 不可用', {
          method: 'scroll', code, alternatives: ['computer_scroll(direction,amount)'],
        })
      }
      throw new PtcError('OPERATION_FAILED', result.error || 'UIA scroll 失败', { method: 'scroll', code })
    }
    const moved = result.moved === undefined
      ? (result.code === 'scroll_unverified' ? null : undefined)
      : result.moved
    if (moved === false) {
      throw new PtcError('OPERATION_FAILED', 'UIA scroll 没有产生可见移动', {
        method: 'scroll', code: 'scroll_no_effect', moved: false,
        axisMoved: result.axisMoved,
        percentBefore: result.percentBefore,
        percentAfter: result.percentAfter,
      })
    }
    return {
      dispatched: true,
      ...(moved === undefined ? {} : { moved }),
      ...(moved === null ? { effect: 'unverified' } : {}),
      ...(result.axisMoved === undefined ? {} : { axisMoved: result.axisMoved }),
      ...(result.attempted === undefined ? {} : { attempted: result.attempted }),
      ...(result.scrolled === undefined ? {} : { scrolled: result.scrolled }),
      ...(result.percentBefore === undefined ? {} : { percentBefore: result.percentBefore }),
      ...(result.percentAfter === undefined ? {} : { percentAfter: result.percentAfter }),
      ...(result.role === undefined ? {} : { role: result.role }),
      ...(result.name === undefined ? {} : { name: result.name }),
      ...(result.source === undefined ? {} : { source: result.source }),
    }
  }

  async function performAction(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'performAction')
    const snap = currentSnapshotOrThrow()
    if (Number(snap.pid) !== pid) {
      throw new PtcError('STALE_SNAPSHOT', '当前快照属于另一个应用；请重新 getAccessibilityTree()', { pid })
    }
    const target = elementTarget(params, snap, 'performAction')
    const requested = canonicalActionName(params.action)
    const available = (target.entry.actions || []).map(canonicalActionName)
    if (available.length > 0 && !available.includes(requested)) {
      throw new PtcError('CAPABILITY_UNAVAILABLE', `元素没有声明 action "${params.action}"`, {
        method: 'performAction', action: params.action, availableActions: target.entry.actions,
        alternatives: ['invoke()', 'setValue()', 'click()'],
      })
    }
    if (requested === 'invoke') return invoke(params, exec)
    if (requested === 'setvalue') {
      if (!['string', 'number', 'boolean'].includes(typeof params.argument)) {
        throw new PtcError('INVALID_ARGUMENT', 'ValuePattern.SetValue 需要字符串/数字/布尔 argument', {
          method: 'performAction', action: params.action,
        })
      }
      return setValue({ ...params, value: params.argument }, exec)
    }
    throw new PtcError('CAPABILITY_UNAVAILABLE', `performAction 尚不支持 action "${params.action}"`, {
      method: 'performAction', action: params.action, availableActions: target.entry.actions,
      alternatives: ['invoke()', 'setValue()', 'click()'],
    })
  }

  async function activate(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'activate')
    const app = await appInfoFor(pid)
    const records = await listWindowsFor(pid, app.name)
    const picked = chooseWindow(records, params.windowId)
    await callInner('computer_activate', { window_id: picked.windowId, pid }, exec)
    return { dispatched: true }
  }

  async function screenshot(params, exec) {
    const pid = parseAppHandle(params.appHandle, 'screenshot')
    const app = await appInfoFor(pid)
    const records = await listWindowsFor(pid, app.name)
    const picked = chooseWindow(records, params.windowId)
    return captureWindowBytes(ctx, {
      pid,
      window_id: picked.windowId,
      title: picked.title,
      app_name: picked.appName,
    }, cfg, exec)
  }

  async function dispatch(method, params, exec) {
    switch (method) {
      case 'getCapabilities': return capabilities()
      case 'listApps': return listApps()
      case 'findApps': return findApps(params.query)
      case 'getApp': return getApp(params.selector, exec)
      case 'listWindows': {
        const pid = parseAppHandle(params.appHandle, 'listWindows')
        const app = await appInfoFor(pid)
        return listWindows(pid, app.name)
      }
      case 'getState': return getState(params, exec)
      case 'activate': return activate(params, exec)
      case 'listActions': return listActions(params)
      case 'invoke': return invoke(params, exec)
      case 'setValue': return setValue(params, exec)
      case 'typeText': return typeText(params, exec)
      case 'pressKey': return pressKey(params, exec)
      case 'mouseMove': return mouseMove(params, exec)
      case 'click': return click(params, exec)
      case 'drag': return drag(params, exec)
      case 'screenshot': return screenshot(params, exec)
      case 'show': return show(params, exec)
      case 'scroll': return scroll(params, exec)
      case 'performAction': return performAction(params, exec)
      case 'selectText':
      case 'paste':
      case 'sendKeyEvent':
        throw capabilityUnavailable(method)
      default:
        throw capabilityUnavailable(method)
    }
  }

  return {
    name: 'computer_cua',
    description:
      'PTC 对象桥接（实验性，默认 off）：用官方风格 {method, params} 访问应用/窗口对象。'
      + '核心方法：getCapabilities/listApps/findApps/getApp/listWindows/getState/activate/listActions/'
      + 'invoke/setValue/typeText/pressKey/mouseMove/click/drag/screenshot/show/scroll/performAction。'
      + '元素 ID 必须来自最新 getState 的 snapshotId:<index>；动作前先 getState。'
      + 'performAction 仅支持 Invoke/ValuePattern.SetValue；scroll 依赖目标点的 UIA ScrollPattern；'
      + 'selectText/paste/sendKeyEvent 本轮返回 CAPABILITY_UNAVAILABLE 与替代路径。'
      + '所有动作仍受 autonomy 策略、stop 锁存与 Windows 投递阶梯约束。'
      + '不要把本工具当普通桌面动作直接调用；PTC 中通过 connectCua 对象层使用。',
    parameters: {
      method: {
        type: 'string',
        required: true,
        enum: [...METHOD_NAMES],
        description: '官方风格操作名。',
      },
      params: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: '方法参数；未知键会被协议层拒绝。',
      },
    },
    output: {
      schema: {
        oneOf: [
          { type: 'array', items: { type: 'object', additionalProperties: true } },
          { type: 'array', items: { type: 'string' } },
          { type: 'object', additionalProperties: true },
        ],
      },
      render: (_args, value) => {
        if (value && value.attachment && value.data) {
          const { data: _data, ...meta } = value
          const attachment = value.attachment
          return [
            { type: 'text', text: JSON.stringify(meta) },
            {
              type: 'image',
              attachment: {
                attachmentId: attachment.attachmentId,
                mediaType: attachment.mediaType,
                bytes: attachment.bytes,
                width: attachment.width,
                height: attachment.height,
                ...(attachment.name === undefined ? {} : { name: attachment.name }),
              },
            },
          ]
        }
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    execute: wrap('computer_cua', async (args, _cfg2, exec) => {
      const method = validateRequest(args.method, args.params || {})
      const params = args.params || {}
      const handle = params.appHandle
      const pid = typeof handle === 'string' && handle.startsWith(APP_HANDLE_PREFIX)
        ? Number(handle.slice(APP_HANDLE_PREFIX.length))
        : 0
      logPtcCall({
        method,
        app: Number.isInteger(pid) && pid > 0 ? `${APP_HANDLE_PREFIX}${pid}` : null,
        windowId: params.windowId,
        origin: exec?.agent?.session?.header?.origin || 'main',
      })
      return dispatch(method, params, exec)
    }),
  }
}
