#!/usr/bin/env node
// Patch-bumps the deployed apps named on the command line. Prints the bump
// commit message to stdout (nothing when no app was bumped).
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUMPABLE = {
  '@sassy-auth/admin': 'apps/admin',
  '@sassy-auth/admin-e2e': 'apps/admin-e2e',
  '@sassy-auth/auth-server': 'apps/auth-server',
}

export function bumpPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) throw new Error(`not an x.y.z version: ${version}`)
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

export function bumpPackages(affected, root) {
  const bumps = []
  for (const name of affected) {
    const dir = BUMPABLE[name]
    if (!dir) continue
    const file = join(root, dir, 'package.json')
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    const from = pkg.version
    pkg.version = bumpPatch(from)
    writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
    bumps.push({ name, short: name.replace('@sassy-auth/', ''), from, to: pkg.version })
  }
  return bumps
}

export function commitMessage(bumps) {
  return `chore: bump ${bumps.map((b) => `${b.short} to ${b.to}`).join(', ')} [version-bump]`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const bumps = bumpPackages(process.argv.slice(2), root)
  if (bumps.length) console.log(commitMessage(bumps))
}
