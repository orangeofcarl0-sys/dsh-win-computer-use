/**
 * nativeDialogs.js —— Windows 标准 Win32 对话框的原生后端（无 UIA）。
 *
 * 背景：WinForms MessageBox 打开时，目标进程的 UIA provider 不服务跨进程请求；
 * 驱动 click/press_key/bring_to_front 会阻塞到模态关闭。原生 Win32 子控件枚举
 * 与 BM_CLICK 仍可用（evals/probe-modal-* 实测）。本模块只做标准 #32770
 * 模态对话框的“读按钮 + 点按钮”，不做输入、不自动选择、不碰普通窗口。
 *
 * 语义：任何失败/超时/非 Windows/脚本缺失 → null 或 ok:false，调用方回退 UIA。
 * 安全：脚本内再次校验 pid/class/modal/button enabled+visible；只发 BM_CLICK。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'native-dialog.ps1')

export const IS_WINDOWS = process.platform === 'win32'

function defaultSpawn(cmd, args, opts) {
  return spawn(cmd, args, opts)
}

function decodeB64Text(value) {
  if (!value) return ''
  try { return Buffer.from(String(value), 'base64').toString('utf8') } catch { return '' }
}

function decodeText(b64, plain) {
  return decodeB64Text(b64) || String(plain ?? '')
}

function normalizeRect(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    x: Number(r.x) || 0,
    y: Number(r.y) || 0,
    w: Number(r.w) || 0,
    h: Number(r.h) || 0,
  }
}

function normalizeButton(raw) {
  const b = raw && typeof raw === 'object' ? raw : {}
  return {
    hwnd: Number(b.hwnd) || 0,
    id: Number(b.id) || 0,
    className: String(b.className || ''),
    label: decodeText(b.labelB64, b.label),
    rect: normalizeRect(b.rect),
    enabled: b.enabled !== false,
    visible: b.visible !== false,
    default: b.default === true,
  }
}

/**
 * 执行一次 sidecar。返回解析后的 JSON；超时/非零/非 JSON/脚本缺失 → null。
 * @param {string[]} args
 * @param {number} timeoutMs
 * @param {Function} spawnFn
 */
function runNative(args, timeoutMs, spawnFn) {
  // 注入 spawnFn = 测试/嵌入方显式接管进程创建；此时不因宿主平台短路。
  if ((!IS_WINDOWS && spawnFn === defaultSpawn) || !existsSync(SCRIPT)) return Promise.resolve(null)
  const limit = Math.max(500, Number(timeoutMs) || 2500)
  return new Promise((resolve) => {
    let out = ''
    let child = null
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child?.kill() } catch { /* 已退出 */ }
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), limit)
    try {
      child = spawnFn(process.env.DSH_POWERSHELL || 'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      return finish(null)
    }
    child.stdout?.on?.('data', (d) => { out += d })
    child.stderr?.on?.('data', () => { /* 诊断进 stderr; 失败即回退 */ })
    child.on?.('error', () => finish(null))
    child.on?.('close', (code) => {
      if (settled) return
      if (code !== 0) return finish(null)
      try {
        const line = out.trim().split(/\r?\n/).filter(Boolean).pop()
        const value = JSON.parse(line)
        finish(value && typeof value === 'object' ? value : null)
      } catch {
        finish(null)
      }
    })
  })
}

/**
 * 扫描标准 Win32 模态对话框。
 * @param {{pid:number, hwnd:number, timeoutMs?:number}} opts
 * @param {Function} [spawnFn]
 * @returns {Promise<null|{ok:true,isDialog:true,modal:boolean,title:string,className:string,ownerHwnd:number,ownerPid:number,ownerEnabled:boolean,foreground:number,buttons:Array,staticText:string,hasEdit:boolean}>}
 */
export async function scanNativeDialog({ pid, hwnd, timeoutMs = 2500 } = {}, spawnFn = defaultSpawn) {
  if (!Number.isFinite(Number(pid)) || !Number.isFinite(Number(hwnd))) return null
  const raw = await runNative(['-Action', 'scan', '-Pid', String(pid), '-Hwnd', String(hwnd)], timeoutMs, spawnFn)
  if (!raw || raw.ok !== true || raw.isDialog !== true) return null
  const buttons = (Array.isArray(raw.buttons) ? raw.buttons : raw.buttons ? [raw.buttons] : [])
    .map(normalizeButton)
    .filter((b) => b.id !== 0 || b.label)
  return {
    ok: true,
    isDialog: true,
    modal: raw.modal === true,
    modalProof: String(raw.modalProof || ''),
    className: String(raw.className || ''),
    title: String(raw.title || ''),
    rect: normalizeRect(raw.rect),
    ownerHwnd: Number(raw.ownerHwnd) || 0,
    ownerPid: Number(raw.ownerPid) || 0,
    ownerEnabled: Boolean(raw.ownerEnabled),
    foreground: Number(raw.foreground) || 0,
    buttons,
    staticText: decodeText(raw.staticTextB64, raw.staticText),
    hasEdit: Boolean(raw.hasEdit),
  }
}

/**
 * 点击标准 Win32 对话框中的标准 Button（BM_CLICK）。
 * @param {{pid:number, hwnd:number, controlId:number, className?:string, label?:string, timeoutMs?:number}} opts
 * @param {Function} [spawnFn]
 * @returns {Promise<{ok:boolean,method:string,dialogAlive:boolean,error:string}>}
 */
export async function clickNativeDialog({
  pid, hwnd, controlId, className = '', label = '', timeoutMs = 4000,
} = {}, spawnFn = defaultSpawn) {
  if (!Number.isFinite(Number(pid)) || !Number.isFinite(Number(hwnd)) || !Number.isFinite(Number(controlId))) {
    return { ok: false, method: '', dialogAlive: false, error: 'invalid_arguments' }
  }
  const labelB64 = Buffer.from(String(label || ''), 'utf8').toString('base64')
  const raw = await runNative([
    '-Action', 'click',
    '-Pid', String(pid),
    '-Hwnd', String(hwnd),
    '-ControlId', String(controlId),
    '-ClassName', String(className || ''),
    '-LabelB64', labelB64,
  ], timeoutMs, spawnFn)
  if (!raw) return { ok: false, method: '', dialogAlive: false, error: 'native_dialog_helper_unavailable' }
  return {
    ok: raw.ok === true,
    method: String(raw.method || ''),
    dialogAlive: raw.dialogAlive === true,
    error: String(raw.error || ''),
  }
}
