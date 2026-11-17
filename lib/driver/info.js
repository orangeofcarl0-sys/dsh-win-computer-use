/**
 * driver/info.js —— 驱动信息缓存与诊断。
 *
 * 能力探测每进程一次（首次调用时惰性触发）；driverProfile 配置变化时重置。
 * 探测失败不抛错：返回 unknown 能力，真实调用仍会给出原有 ENOENT/超时错误。
 */
import { defaultTransport } from './transport.js'
import { baseCapabilities, capabilitySummary, detectCapabilities } from './capabilities.js'

let configuredProfile = 'auto'
let cached = null
let pending = null

/** apply() 时调用：记录配置 profile 并让下一次探测重新开始。 */
export function configureDriver({ profile = 'auto' } = {}) {
  configuredProfile = profile || 'auto'
  cached = null
  pending = null
}

export function configuredDriverProfile() {
  return configuredProfile
}

/**
 * 取驱动信息（缓存）。transport 参数仅供测试注入。
 * @returns {Promise<{bin:string, version:string|null, profile:string, contract:object|null, caps:object, warnings:string[], detectedAt:number}>}
 */
export async function ensureDriverInfo({ transport = defaultTransport } = {}) {
  if (cached) return cached
  if (pending) return pending
  pending = detectCapabilities({ transport, profile: configuredProfile })
    .then((caps) => {
      cached = {
        bin: transport.bin,
        version: caps.version,
        profile: caps.profile,
        contract: caps.contract,
        caps,
        warnings: [...(caps.warnings || [])],
        detectedAt: Date.now(),
      }
      return cached
    })
    .catch((err) => {
      const caps = baseCapabilities()
      caps.warnings.push(`能力探测失败：${String(err?.message || err).slice(0, 200)}`)
      cached = {
        bin: transport.bin,
        version: null,
        profile: caps.profile,
        contract: null,
        caps,
        warnings: [...caps.warnings],
        detectedAt: Date.now(),
      }
      return cached
    })
  return pending
}

/** 同步读取已探测信息（未探测为 null）。 */
export function getDriverInfoSync() {
  return cached
}

/** 取消缓存（测试/apply 重置）。 */
export function resetDriverInfo() {
  cached = null
  pending = null
}

/** 能力对象（引用；learnFromResponse 会原地更新）。 */
export async function driverCapabilities(opts) {
  return (await ensureDriverInfo(opts)).caps
}

/** 一行 status 文本：驱动路径 + 版本/能力 + warnings。 */
export function driverStatusLine(info = cached) {
  if (!info) return '驱动：未探测（首次调用时探测）'
  const warns = (info.warnings || []).length > 0 ? `；警告：${info.warnings.join('；')}` : ''
  return `驱动：${capabilitySummary(info.caps)} · bin=${info.bin}${warns}`
}

/** 能力探测结果是否已过期（供诊断；当前不做 TTL）。 */
export function driverInfoAgeMs(info = cached) {
  return info ? Date.now() - info.detectedAt : null
}
