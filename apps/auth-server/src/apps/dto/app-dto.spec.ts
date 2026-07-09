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

  it('accepts https url and no callbackUrl', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts an empty-string callbackUrl as "default" (no error)', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'https://a.example.com', callbackUrl: '' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts a valid https callbackUrl', () => {
    const dto = plainToInstance(CreateAppDto, {
      name: 'A', url: 'https://a.example.com', callbackUrl: 'https://a.example.com/auth/cb',
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects an http callbackUrl in secure mode', () => {
    const dto = plainToInstance(CreateAppDto, {
      name: 'A', url: 'https://a.example.com', callbackUrl: 'http://localhost/cb',
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('rejects an http app url in secure mode', () => {
    const dto = plainToInstance(CreateAppDto, { name: 'A', url: 'http://localhost:3000' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('UpdateAppDto: omitting callbackUrl is valid', () => {
    const dto = plainToInstance(UpdateAppDto, { name: 'B' });
    expect(validateSync(dto)).toHaveLength(0);
  });
});
