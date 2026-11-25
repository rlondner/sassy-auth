import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bumpPatch, bumpPackages, commitMessage, BUMPABLE } from './bump-versions.mjs'

function fixture(versions) {
  const root = mkdtempSync(join(tmpdir(), 'bump-'))
  for (const [name, dir] of Object.entries(BUMPABLE)) {
    mkdirSync(join(root, dir), { recursive: true })
    const short = name.replace('@sassy-auth/', '')
    writeFileSync(
      join(root, dir, 'package.json'),
      JSON.stringify({ name, version: versions[short] ?? '0.5.0' }, null, 2) + '\n',
    )
  }
  return root
}
const read = (root, dir) => readFileSync(join(root, dir, 'package.json'), 'utf8')

test('bumpPatch increments the patch component', () => {
  assert.equal(bumpPatch('0.5.9'), '0.5.10')
})

test('bumpPatch throws on non x.y.z input', () => {
  assert.throws(() => bumpPatch('1.2'))
})

test('bumpPackages ignores non-bumpable packages', () => {
  const root = fixture({})
  const before = read(root, 'apps/admin')
  assert.deepEqual(bumpPackages(['@sassy-auth/db'], root), [])
  assert.equal(read(root, 'apps/admin'), before)
})

test('bumpPackages bumps only affected apps and keeps trailing newline', () => {
  const root = fixture({ admin: '0.6.1', 'auth-server': '0.5.8' })
  const res = bumpPackages(['@sassy-auth/admin', '@sassy-auth/db'], root)
  assert.deepEqual(res, [{ name: '@sassy-auth/admin', short: 'admin', from: '0.6.1', to: '0.6.2' }])
  assert.ok(read(root, 'apps/admin').endsWith('}\n'))
  assert.equal(JSON.parse(read(root, 'apps/admin')).version, '0.6.2')
  assert.equal(JSON.parse(read(root, 'apps/auth-server')).version, '0.5.8')
})

test('commitMessage lists bumped apps with marker last', () => {
  const two = [
    { short: 'admin', to: '0.6.2' },
    { short: 'auth-server', to: '0.5.9' },
  ]
  assert.equal(commitMessage(two), 'chore: bump admin to 0.6.2, auth-server to 0.5.9 [version-bump]')
  assert.equal(commitMessage([two[1]]), 'chore: bump auth-server to 0.5.9 [version-bump]')
})
