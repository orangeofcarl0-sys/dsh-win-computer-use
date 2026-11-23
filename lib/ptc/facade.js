/**
 * facade.js —— PTC 对象层。
 *
 * 这个模块运行在 PTC 程序里，不 import 宿主包；唯一外部输入是
 * tools.computer_cua 绑定（或任何同形状函数）。它只负责：
 *   - app/window 对象与目标注入；
 *   - 每个 app 的当前 snapshotId/windowId 跟踪；
 *   - 元素 ID 前缀校验；
 *   - 截图 base64 → Uint8Array；
 *   - 把工具错误转成带 code/details 的 CuaError。
 *
 * 不做授权：所有动作仍由 computer_cua → 现有工具 → autonomy 策略执行。
 */

import { Buffer } from 'node:buffer'

/** PTC 侧错误；message 带 CODE 前缀，code/details 供程序分支。 */
export class CuaError extends Error {
  constructor(code, message, details = undefined) {
    super(`${code}: ${message}`)
    this.name = 'CuaError'
    this.code = code
    this.details = details
  }
}

function normalizeError(error) {
  if (error instanceof CuaError) return error
  const message = String(error?.message || error)
  const match = message.match(/^([A-Z][A-Z0-9_]+):\s*(.*)$/s)
  if (match) return new CuaError(match[1], match[2], error?.details)
  return new CuaError('OPERATION_FAILED', message, error?.details)
}

function splitElementId(value, method) {
  if (typeof value !== 'string' || !value.includes(':')) {
    throw new CuaError('INVALID_ARGUMENT', `${method} 的 elementId 必须是 "<snapshotId>:<index>"`)
  }
  const at = value.lastIndexOf(':')
  const snapshotId = value.slice(0, at)
  const index = Number(value.slice(at + 1))
  if (!snapshotId || !Number.isInteger(index) || index < 0) {
    throw new CuaError('INVALID_ARGUMENT', `${method} 的 elementId 格式无效`)
  }
  return { snapshotId, index }
}

function pointOf(target, method) {
  if (typeof target === 'string') return null
  if (!Array.isArray(target) || target.length !== 2) {
    throw new CuaError('INVALID_ARGUMENT', `${method} target 必须是 elementId 字符串或 [x, y]`)
  }
  const [x, y] = target.map(Number)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new CuaError('INVALID_ARGUMENT', `${method} 的坐标必须是非负数字`)
  }
  return { x, y }
}

/**
 * 连接对象层。
 * @param {Function|object} getTool - () => tools.computer_cua，或直接传函数
 * @param {{onText?:(text:string)=>void|Promise<void>, onImage?:(image:object)=>void|Promise<void>}} [options]
 */
export function connectCua(getTool, options = {}) {
  const resolveTool = typeof getTool === 'function' ? getTool : () => getTool
  const onText = options.onText
  const onImage = options.onImage
  const states = new Map()   // appHandle -> { snapshotId, windowId }

  async function call(method, params = {}) {
    try {
      // 官方 connectCua 接收 () => tools.computer_cua（零参 getter）；
      // 也兼容直接传绑定函数（参数个数 >= 1）。
      let binding = resolveTool
      if (resolveTool.length === 0) binding = await resolveTool()
      if (typeof binding !== 'function') {
        throw new CuaError('CAPABILITY_UNAVAILABLE', 'getTool 没有返回 tools.computer_cua 绑定')
      }
      const value = await binding({ method, params })
      if (value && value.ok === false) {
        throw new CuaError('OPERATION_FAILED', String(value.result || `${method} 失败`), value)
      }
      return value
    } catch (error) {
      throw normalizeError(error)
    }
  }

  async function emitText(value, options_) {
    if (options_?.emit === false) return
    await onText?.(typeof value === 'string' ? value : JSON.stringify(value))
  }

  function remember(appHandle, state) {
    if (!state || !state.snapshotId) {
      throw new CuaError('OBSERVE_REQUIRED', '观察没有返回 snapshotId')
    }
    states.set(appHandle, { snapshotId: String(state.snapshotId), windowId: Number(state.windowId) })
  }

  function snapshotFor(appHandle) {
    const state = states.get(appHandle)
    if (!state) throw new CuaError('OBSERVE_REQUIRED', '请先 app.getAccessibilityTree() 建立快照')
    return state
  }

  function elementRef(appHandle, elementId, method) {
    const parsed = splitElementId(elementId, method)
    const state = snapshotFor(appHandle)
    if (parsed.snapshotId !== state.snapshotId) {
      throw new CuaError('STALE_SNAPSHOT', `${method} 的元素 ${elementId} 已过期；请重新 getAccessibilityTree()`, {
        current: state.snapshotId, element: elementId,
      })
    }
    return { snapshotId: parsed.snapshotId, elementId }
  }

  function createSurface(appHandle, windowId) {
    const scope = windowId === undefined ? { appHandle } : { appHandle, windowId }

    async function getAccessibilityTree(options_ = {}) {
      const state = await call('getState', {
        ...scope,
        ...(options_?.maxElements === undefined ? {} : { maxElements: options_.maxElements }),
        ...(options_?.maxDepth === undefined ? {} : { maxDepth: options_.maxDepth }),
        ...(options_?.includeMenus === undefined ? {} : { includeMenus: options_.includeMenus }),
        ...(options_?.details === undefined ? {} : { details: options_.details }),
      })
      remember(appHandle, state)
      if (options_.emit !== false) await emitText(state.tree, options_)
      return state.tree
    }

    async function listActions(elementId) {
      const ref = elementRef(appHandle, elementId, 'listActions')
      return call('listActions', { ...scope, ...ref })
    }

    async function invoke(elementId) {
      const ref = elementRef(appHandle, elementId, 'invoke')
      return call('invoke', { ...scope, ...ref })
    }

    async function setValue(elementId, value) {
      const ref = elementRef(appHandle, elementId, 'setValue')
      return call('setValue', { ...scope, ...ref, value })
    }

    async function performAction(elementId, action, argument) {
      const ref = elementRef(appHandle, elementId, 'performAction')
      return call('performAction', {
        ...scope, ...ref, action,
        ...(argument === undefined ? {} : { argument }),
      })
    }

    async function selectText(elementId, text, options_ = {}) {
      const ref = elementRef(appHandle, elementId, 'selectText')
      return call('selectText', {
        ...scope, ...ref, text,
        ...(options_.prefix === undefined ? {} : { prefix: options_.prefix }),
        ...(options_.suffix === undefined ? {} : { suffix: options_.suffix }),
        ...(options_.selectionType === undefined ? {} : { selectionType: options_.selectionType }),
      })
    }

    async function typeText(text) {
      return call('typeText', { ...scope, text })
    }

    async function paste(text, options_ = {}) {
      return call('paste', {
        ...scope, text,
        ...(options_.format === undefined ? {} : { format: options_.format }),
      })
    }

    async function pressKey(key, modifiers = []) {
      return call('pressKey', { ...scope, key, modifiers: [...modifiers] })
    }

    async function sendKeyEvent(key, direction) {
      return call('sendKeyEvent', { ...scope, key, direction })
    }

    async function show() {
      return call('show', scope)
    }

    return {
      getAccessibilityTree,
      listActions,
      invoke,
      setValue,
      performAction,
      selectText,
      typeText,
      paste,
      pressKey,
      sendKeyEvent,
      show,
    }
  }

  function createWindow(appHandle, windowId) {
    const surface = createSurface(appHandle, windowId)
    return {
      windowId,
      ...surface,
      async getScreenshot(options_ = {}) {
        const value = await call('screenshot', { appHandle, windowId })
        const screenshot = {
          bytes: Uint8Array.from(Buffer.from(String(value.data || ''), 'base64')),
          mimeType: value.mimeType,
          pixelWidth: value.pixelWidth,
          pixelHeight: value.pixelHeight,
          windowId: value.windowId,
        }
        if (options_.emit !== false) await onImage?.(screenshot)
        return screenshot
      },
      async mouseMove(target, options_ = {}) {
        const point = pointOf(target, 'mouseMove')
        if (!point) {
          const ref = elementRef(appHandle, target, 'mouseMove')
          return call('mouseMove', {
            appHandle, windowId, ...ref,
            ...(options_.relative === undefined ? {} : { relative: options_.relative }),
            ...(options_.useSystemPointer === undefined ? {} : { useSystemPointer: options_.useSystemPointer }),
          })
        }
        return call('mouseMove', {
          appHandle, windowId, ...point,
          ...(options_.relative === undefined ? {} : { relative: options_.relative }),
          ...(options_.useSystemPointer === undefined ? {} : { useSystemPointer: options_.useSystemPointer }),
        })
      },
      async click(target, options_ = {}) {
        const point = pointOf(target, 'click')
        const base = { appHandle, windowId }
        if (!point) {
          const ref = elementRef(appHandle, target, 'click')
          return call('click', {
            ...base, ...ref,
            ...(options_.mouseButton === undefined ? {} : { mouseButton: options_.mouseButton }),
            ...(options_.clickCount === undefined ? {} : { clickCount: options_.clickCount }),
            ...(options_.modifiers === undefined ? {} : { modifiers: [...options_.modifiers] }),
            ...(options_.holdMs === undefined ? {} : { holdMs: options_.holdMs }),
            ...(options_.relative === undefined ? {} : { relative: options_.relative }),
          })
        }
        return call('click', {
          ...base, ...point,
          ...(options_.mouseButton === undefined ? {} : { mouseButton: options_.mouseButton }),
          ...(options_.clickCount === undefined ? {} : { clickCount: options_.clickCount }),
          ...(options_.modifiers === undefined ? {} : { modifiers: [...options_.modifiers] }),
          ...(options_.holdMs === undefined ? {} : { holdMs: options_.holdMs }),
          ...(options_.relative === undefined ? {} : { relative: options_.relative }),
        })
      },
      async scroll(options_) {
        return call('scroll', { appHandle, windowId, ...options_ })
      },
      async drag(from, to, options_ = {}) {
        const a = pointOf(from, 'drag.from')
        const b = pointOf(to, 'drag.to')
        if (!a || !b) throw new CuaError('INVALID_ARGUMENT', 'drag 的 from/to 必须是 [x, y]')
        return call('drag', {
          appHandle, windowId,
          fromX: a.x, fromY: a.y,
          toX: b.x, toY: b.y,
          ...(options_.mouseButton === undefined ? {} : { mouseButton: options_.mouseButton }),
          ...(options_.modifiers === undefined ? {} : { modifiers: [...options_.modifiers] }),
          ...(options_.relative === undefined ? {} : { relative: options_.relative }),
        })
      },
    }
  }

  function createApp(appHandle, appInfo) {
    const surface = createSurface(appHandle)
    return {
      appHandle,
      ...surface,
      async getWindows(options_ = {}) {
        const windows = await call('listWindows', { appHandle })
        if (options_.emit !== false) await emitText(windows, options_)
        return windows.map((w) => ({ ...w, appName: w.appName || appInfo?.name || '' }))
      },
      getWindow(windowId) {
        if (!Number.isInteger(Number(windowId)) || Number(windowId) <= 0) {
          return Promise.reject(new CuaError('INVALID_ARGUMENT', 'windowId 必须是正整数'))
        }
        return Promise.resolve(createWindow(appHandle, Number(windowId)))
      },
      async activate() {
        return call('activate', { appHandle })
      },
    }
  }

  const api = {
    async getCapabilities(options_ = {}) {
      const value = await call('getCapabilities')
      if (options_.emit !== false) await emitText(value, options_)
      return value
    },
    async listApps(options_ = {}) {
      const apps = (await call('listApps')).map((app) => ({
        id: app.bundleId || String(app.pid),
        displayName: app.name,
        isRunning: true,
        pid: app.pid,
      }))
      if (options_.emit !== false) await emitText(apps, options_)
      return apps
    },
    async findApps(query, options_ = {}) {
      const apps = await call('findApps', { query })
      if (options_.emit !== false) await emitText(apps, options_)
      return apps
    },
    async getState(options_ = {}) {
      const value = { apps: await api.listApps({ emit: false }), browsers: [] }
      if (options_.emit !== false) await emitText(value, options_)
      return value
    },
    async getApp(selector) {
      const info = await call('getApp', { selector })
      return createApp(info.appHandle, info)
    },
  }

  return api
}

/** 别名：明确这是 Windows PTC 对象层。 */
export const connectWinCua = connectCua
