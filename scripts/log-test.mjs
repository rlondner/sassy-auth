#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , name, command, ...args] = process.argv;

if (!name || !command) {
  console.error('Usage: log-test.mjs <log-prefix> <command> [args...]');
  process.exit(2);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(repoRoot, 'test-results');
mkdirSync(dir, { recursive: true });

const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
  `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const file = join(dir, `${name}-${stamp}.txt`);
const out = createWriteStream(file);

console.log(`> logging to ${file}`);

const child = spawn([command, ...args].join(' '), {
  shell: true,
  stdio: ['inherit', 'pipe', 'pipe'],
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.stdout.pipe(out);
child.stderr.pipe(out);

child.on('exit', (code, signal) => {
  out.end();
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
