import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveHttpsOptions } from './https-options';

// bug-0290: 0002a11 introduced synchronous fs.readFileSync calls for the
// mkcert dev certificates, unconditionally whenever NODE_ENV !== 'production'.
// Those certs are gitignored and machine-generated (README → "Local HTTPS
// certificates"), so they are absent on a fresh clone, in CI (NODE_ENV=test,
// see .github/workflows/e2e.yml), and in the Docker image — main.ts crashed
// with an uncaught ENOENT before the server could bind. This spec verifies
// the extracted resolveHttpsOptions() falls back to plain HTTP (undefined)
// instead of throwing when the certs are missing, and still loads them when
// present.
describe('resolveHttpsOptions (bug-0290)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sassy-auth-secrets-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns undefined (no throw) when isDev but certs are missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => resolveHttpsOptions(true, tmpDir)).not.toThrow();
    expect(resolveHttpsOptions(true, tmpDir)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[bug-0290]'));
    warnSpy.mockRestore();
  });

  it('returns undefined when not isDev, even if certs are present', () => {
    fs.writeFileSync(path.join(tmpDir, 'localhost-key.pem'), 'key');
    fs.writeFileSync(path.join(tmpDir, 'localhost.pem'), 'cert');
    expect(resolveHttpsOptions(false, tmpDir)).toBeUndefined();
  });

  it('loads key and cert buffers when isDev and both files exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'localhost-key.pem'), 'the-key');
    fs.writeFileSync(path.join(tmpDir, 'localhost.pem'), 'the-cert');
    const result = resolveHttpsOptions(true, tmpDir);
    expect(result).toBeDefined();
    expect(result?.key.toString()).toBe('the-key');
    expect(result?.cert.toString()).toBe('the-cert');
  });

  it('returns undefined when only one of the two cert files is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'localhost-key.pem'), 'the-key');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveHttpsOptions(true, tmpDir)).toBeUndefined();
    warnSpy.mockRestore();
  });
});
