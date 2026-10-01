import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateAppDto } from './create-app.dto';
import { UpdateAppDto } from './update-app.dto';


describe('App DTO validation (secure mode)', () => {
  const original = process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
  beforeEach(() => { delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS; });
  afterAll(() => {
    if (original === undefined) delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    else process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = original;
  });

  it('accepts https url', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects an http app url in secure mode', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://localhost:3010' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('UpdateAppDto: omitting url is valid', () => {
    const dto = plainToInstance(UpdateAppDto, { name: 'B' });
    expect(validateSync(dto)).toHaveLength(0);
  });
});

describe('UpdateAppDto — twoFactorTrustDays validation', () => {
  async function check(value: unknown): Promise<string[]> {
    const dto = Object.assign(new UpdateAppDto(), { twoFactorTrustDays: value });
    const errors = validateSync(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts null (clear override)', async () => expect(await check(null)).toHaveLength(0));
  it('accepts undefined (omit)', async () => expect(await check(undefined)).toHaveLength(0));
  it('accepts 1 (minimum positive)', async () => expect(await check(1)).toHaveLength(0));
  it('accepts 14', async () => expect(await check(14)).toHaveLength(0));
  it('accepts 3650 (maximum)', async () => expect(await check(3650)).toHaveLength(0));
  it('rejects 0', async () => expect(await check(0)).not.toHaveLength(0));
  it('rejects -1', async () => expect(await check(-1)).not.toHaveLength(0));
  it('rejects 3651 (above max)', async () => expect(await check(3651)).not.toHaveLength(0));
  it('rejects 7.5 (float)', async () => expect(await check(7.5)).not.toHaveLength(0));
  it('rejects "14" (string)', async () => expect(await check('14')).not.toHaveLength(0));
});

describe('CreateAppDto — twoFactorTrustDays validation', () => {
  async function check(value: unknown): Promise<string[]> {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com', twoFactorTrustDays: value });
    const errors = validateSync(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts null (clear override)', async () => expect(await check(null)).toHaveLength(0));
  it('accepts undefined (omit)', async () => expect(await check(undefined)).toHaveLength(0));
  it('accepts 1 (minimum positive)', async () => expect(await check(1)).toHaveLength(0));
  it('accepts 14', async () => expect(await check(14)).toHaveLength(0));
  it('accepts 3650 (maximum)', async () => expect(await check(3650)).toHaveLength(0));
  it('rejects 0', async () => expect(await check(0)).not.toHaveLength(0));
  it('rejects -1', async () => expect(await check(-1)).not.toHaveLength(0));
  it('rejects 3651 (above max)', async () => expect(await check(3651)).not.toHaveLength(0));
  it('rejects 7.5 (float)', async () => expect(await check(7.5)).not.toHaveLength(0));
  it('rejects "14" (string)', async () => expect(await check('14')).not.toHaveLength(0));
});

describe('UpdateAppDto — twoFactorPromptEnabled validation', () => {
  async function check(value: unknown): Promise<string[]> {
    const dto = Object.assign(new UpdateAppDto(), { twoFactorPromptEnabled: value });
    const errors = validateSync(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts null (inherit system default)', async () => expect(await check(null)).toHaveLength(0));
  it('accepts undefined (omit)', async () => expect(await check(undefined)).toHaveLength(0));
  it('accepts true', async () => expect(await check(true)).toHaveLength(0));
  it('accepts false', async () => expect(await check(false)).toHaveLength(0));
  it('rejects "true" (string)', async () => expect(await check('true')).not.toHaveLength(0));
  it('rejects 1 (number)', async () => expect(await check(1)).not.toHaveLength(0));
});

describe('CreateAppDto — twoFactorPromptEnabled validation', () => {
  async function check(value: unknown): Promise<string[]> {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com', twoFactorPromptEnabled: value });
    const errors = validateSync(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts null (inherit system default)', async () => expect(await check(null)).toHaveLength(0));
  it('accepts undefined (omit)', async () => expect(await check(undefined)).toHaveLength(0));
  it('accepts true', async () => expect(await check(true)).toHaveLength(0));
  it('accepts false', async () => expect(await check(false)).toHaveLength(0));
  it('rejects "true" (string)', async () => expect(await check('true')).not.toHaveLength(0));
});

describe('CreateAppDto — favicon validation', () => {
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('accepts a valid favicon data URI', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com', favicon: TINY_PNG });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts omitting favicon', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a non-data-URI favicon', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com', favicon: 'not-a-data-uri' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});

describe('UpdateAppDto — favicon validation', () => {
  it('accepts null (clear favicon)', () => {
    const dto = Object.assign(new UpdateAppDto(), { favicon: null });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts undefined (omit)', () => {
    const dto = Object.assign(new UpdateAppDto(), { favicon: undefined });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a non-data-URI favicon', () => {
    const dto = Object.assign(new UpdateAppDto(), { favicon: 'not-a-data-uri' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
