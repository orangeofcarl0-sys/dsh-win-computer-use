/**
 * 包清单契约测试（P0-6，2026-11-09）。
 *
 * 背景：宿主 dsh 已是 0.2.2-rc.1，自带 dsh-tools 0.2.2-rc.1 / schemastery 3.19.0；
 * 旧清单把 dsh-tools 固定 0.1.1-rc.2 且放在 dependencies，干净 checkout 无法复现测试。
 * 本测试锁定：宿主包只走 peerDependencies（由宿主提供），devDependencies 固定实测版本，
 * dsh 兼容下限、发布文件清单与权限声明不被误删。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (err) {
    failures++
    console.log(`❌ ${name} — ${String(err.message).slice(0, 160)}`)
  }
}

check('宿主包没有出现在 dependencies', () => {
  const deps = pkg.dependencies || {}
  assert.equal(Object.keys(deps).filter((k) => k.startsWith('@deepseek-ai/')).length, 0, JSON.stringify(deps))
})

check('dsh-tools 走 peerDependencies 且覆盖 0.2.2', () => {
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/dsh-tools'], '>=0.1.5-rc.2 <0.3.0')
})

check('schemastery 走 peerDependencies 且覆盖 3.19.0', () => {
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/schemastery'], '>=3.18.2 <4')
})

check('devDependencies 固定实测宿主版本', () => {
  assert.equal(pkg.devDependencies?.['@deepseek-ai/dsh-tools'], '0.2.2-rc.1')
  assert.equal(pkg.devDependencies?.['@deepseek-ai/schemastery'], '3.19.0')
})

check('dsh 兼容下限仍为 0.1.5-rc.2', () => {
  assert.match(pkg.dsh?.compatibility?.dsh || '', /^>=0\.1\.5-rc\.2/)
})

check('发布文件清单包含运行必需项', () => {
  const files = pkg.files || []
  for (const want of ['index.js', 'lib/', 'tools/', 'cordis.patch.yml', 'docs/']) {
    assert.ok(files.includes(want), `缺少 ${want}: ${files.join(', ')}`)
  }
})

check('dsh 权限声明仍在', () => {
  const p = pkg.dsh?.permissions
  assert.ok(p && typeof p.summary === 'string' && Array.isArray(p.commands), 'permissions 缺失')
})

check('测试脚本包含 P0 边界与清单测试', () => {
  const test = pkg.scripts?.test || ''
  assert.match(test, /action-bounds\.mjs/)
  assert.match(test, /package-manifest\.test\.mjs/)
})

console.log(`\n结果：${failures ? '❌ ' + failures + ' 项失败' : '✅ 全部通过'}`)
process.exit(failures ? 1 : 0)
