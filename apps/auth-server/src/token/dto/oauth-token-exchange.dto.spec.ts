import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OauthTokenExchangeDto } from './oauth-token-exchange.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(OauthTokenExchangeDto, payload);
  return validate(dto);
}

describe('OauthTokenExchangeDto', () => {
  it('requires code and redirect_uri for authorization_code', async () => {
    const errors = await validateDto({
      grant_type: 'authorization_code',
      client_id: 'app-1',
    });
    const properties = errors.map((e) => e.property);
    expect(properties).toEqual(expect.arrayContaining(['code', 'redirect_uri']));
  });

  it('passes for a well-formed authorization_code request', async () => {
    const errors = await validateDto({
      grant_type: 'authorization_code',
      client_id: 'app-1',
      code: 'abc',
      redirect_uri: 'https://example.com/cb',
    });
    expect(errors).toHaveLength(0);
  });

  it('does not require code or redirect_uri for client_credentials', async () => {
    const errors = await validateDto({
      grant_type: 'client_credentials',
      client_id: 'app-1',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an optional scope for client_credentials', async () => {
    const errors = await validateDto({
      grant_type: 'client_credentials',
      client_id: 'app-1',
      scope: 'roles:write',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects an unrecognised grant_type', async () => {
    const errors = await validateDto({ grant_type: 'password', client_id: 'app-1' });
    expect(errors.some((e) => e.property === 'grant_type')).toBe(true);
  });
});
