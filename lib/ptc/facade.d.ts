/**
 * PTC 对象层类型（与 lib/ptc/facade.js 同步）。
 * 这些类型只描述桥接层；服务端行为以 computer_cua 的协议与能力矩阵为准。
 */

export interface CuaError extends Error {
  code: string
  details?: unknown
}

export interface CuaCapabilities {
  platform: string
  permissions: { accessibility: boolean; screenRecording: boolean }
  appLevelAccessibility: boolean
  systemPointer: boolean
  keyboard: Array<'app' | 'window'>
  sessionLocked: boolean | null
  methods: string[]
  coordinateSpace: 'screenshot-pixels'
  browser: false
  methodSupport?: Record<string, { status: 'core' | 'probe' | 'diagnostic'; reason?: string; alternatives?: string[] }>
  driver?: unknown
}

export interface CuaAppInfo {
  id: string
  displayName: string
  isRunning: true
  pid: number
}

export interface CuaFoundAppInfo {
  id: string
  displayName: string
  path: string
  isRunning: boolean
  pid?: number
}

export interface CuaWindowInfo {
  windowId: number
  appName: string
  title: string
  bounds: { x: number; y: number; width: number; height: number }
  isOnScreen: boolean
  onCurrentSpace: boolean | null
}

export interface CuaActionResult {
  dispatched: boolean
  foregroundChanged?: boolean | null
}

export interface CuaHoverResult extends CuaActionResult {
  hoverRoute: 'accessibility' | 'system-pointer'
  systemPointerMoved: boolean
}

export interface CuaScreenshot {
  bytes: Uint8Array
  mimeType: string
  pixelWidth: number
  pixelHeight: number
  windowId: number
}

export interface CuaObservationOptions { emit?: boolean }
export interface CuaAxOptions extends CuaObservationOptions {
  maxElements?: number
  maxDepth?: number
  includeMenus?: boolean
  details?: boolean
}
export interface CuaCoordinateOptions { relative?: boolean }
export interface CuaClickOptions extends CuaCoordinateOptions {
  mouseButton?: 'left' | 'right' | 'middle'
  clickCount?: 1 | 2
  modifiers?: string[]
  holdMs?: number
}
export interface CuaDragOptions extends CuaCoordinateOptions {
  mouseButton?: 'left' | 'right' | 'middle'
  modifiers?: string[]
}
export interface CuaScrollOptions extends CuaCoordinateOptions {
  x: number
  y: number
  deltaLinesX: number
  deltaLinesY: number
}
export interface CuaSelectTextOptions {
  prefix?: string
  suffix?: string
  selectionType?: 'text' | 'cursor_before' | 'cursor_after'
}
export interface CuaPasteOptions { format?: 'text' | 'html' }

export interface CuaScrollResult extends CuaActionResult {
  moved?: boolean | null
  effect?: 'unverified'
  axisMoved?: { h: boolean | null; v: boolean | null }
  attempted?: number
  scrolled?: number
  percentBefore?: { h: number; v: number }
  percentAfter?: { h: number; v: number }
  role?: string
  name?: string
  source?: string
}

export interface CuaSurface {
  show(): Promise<CuaActionResult & { windowId: number | null; foregroundChanged: boolean | null }>
  getAccessibilityTree(options?: CuaAxOptions): Promise<string>
  listActions(elementId: string): Promise<string[]>
  performAction(elementId: string, action: string, argument?: unknown): Promise<CuaActionResult>
  invoke(elementId: string): Promise<CuaActionResult>
  setValue(elementId: string, value: string | number | boolean): Promise<CuaActionResult>
  selectText(elementId: string, text: string, options?: CuaSelectTextOptions): Promise<CuaActionResult>
  typeText(text: string): Promise<CuaActionResult>
  paste(text: string, options?: CuaPasteOptions): Promise<CuaActionResult>
  pressKey(key: string, modifiers?: string[]): Promise<CuaActionResult>
  sendKeyEvent(key: string, direction: 'down' | 'up'): Promise<CuaActionResult>
}

export interface CuaWindow extends CuaSurface {
  readonly windowId: number
  getScreenshot(options?: CuaObservationOptions): Promise<CuaScreenshot>
  mouseMove(target: string | readonly [number, number],
    options?: CuaCoordinateOptions & { useSystemPointer?: boolean }): Promise<CuaHoverResult>
  click(target: string | readonly [number, number], options?: CuaClickOptions): Promise<CuaActionResult>
  scroll(options: CuaScrollOptions): Promise<CuaScrollResult>
  drag(from: readonly [number, number], to: readonly [number, number],
    options?: CuaDragOptions): Promise<CuaActionResult>
}

export interface CuaApp extends CuaSurface {
  readonly appHandle: string
  activate(): Promise<CuaActionResult>
  getWindows(options?: CuaObservationOptions): Promise<CuaWindowInfo[]>
  getWindow(windowId: number): Promise<CuaWindow>
}

export interface CuaApi {
  getCapabilities(options?: CuaObservationOptions): Promise<CuaCapabilities>
  listApps(options?: CuaObservationOptions): Promise<CuaAppInfo[]>
  findApps(query: string, options?: CuaObservationOptions): Promise<CuaFoundAppInfo[]>
  getState(options?: CuaObservationOptions): Promise<{ apps: CuaAppInfo[]; browsers: [] }>
  getApp(selector: string): Promise<CuaApp>
}

export type CuaToolBinding = (operation: { method: string; params?: Record<string, unknown> }) => Promise<unknown>

export function connectCua(
  getTool: (() => CuaToolBinding) | CuaToolBinding,
  options?: { onText?: (text: string) => void | Promise<void>; onImage?: (image: CuaScreenshot) => void | Promise<void> },
): CuaApi

export const connectWinCua: typeof connectCua
