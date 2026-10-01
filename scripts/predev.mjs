#!/usr/bin/env node
// Cross-platform predev hook. The optional Caddy proxy (README.md §6b) is
// Windows-only tooling (scripts/start-caddy.ps1 shells out to `caddy`, a
// Windows-elevated process); on macOS/Linux — or a CI runner — there is
// nothing to start, so this must succeed as a no-op rather than fail
// `pnpm dev` by trying to spawn a `powershell` binary that doesn't exist
// there.
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') {
  console.log('[predev] Skipping optional Caddy proxy setup (Windows-only, see README.md §6b).')
  process.exit(0)
}

const result = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', './scripts/start-caddy.ps1'],
  { stdio: 'inherit' },
)

if (result.error) {
  console.warn(`[predev] Could not run start-caddy.ps1 (${result.error.message}) — continuing without it.`)
}
// start-caddy.ps1 itself never exits non-zero for a missing/failed Caddy
// (see its own comment), but tolerate a non-zero exit here too rather than
// letting an optional dev convenience block `pnpm dev`.
process.exit(0)
