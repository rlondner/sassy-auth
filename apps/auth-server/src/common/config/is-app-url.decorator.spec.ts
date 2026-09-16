import { validateSync } from 'class-validator';
import { IsAppUrl } from './is-app-url.decorator';

class Fixture {
  @IsAppUrl()
  url!: string;
}

function makeWith(url: unknown): Fixture {
  const f = new Fixture();
  // @ts-expect-error test assigns arbitrary values
  f.url = url;
  return f;
}

describe('IsAppUrl', () => {
  const original = process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
  afterEach(() => {
    if (original === undefined) delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    else process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = original;
  });

  it('passes for https public host in secure mode', () => {
    delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    expect(validateSync(makeWith('https://app.example.com'))).toHaveLength(0);
  });

  it('fails for http localhost in secure mode', () => {
    delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    const errs = validateSync(makeWith('https://localhost:3010'));
    expect(errs).toHaveLength(1);
    expect(errs[0].constraints?.isAppUrl).toContain('https');
  });

  it('passes for http localhost in insecure mode', () => {
    process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = 'true';
    expect(validateSync(makeWith('https://localhost:3010'))).toHaveLength(0);
  });
});
