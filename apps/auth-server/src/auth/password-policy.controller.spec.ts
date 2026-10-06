jest.mock('./resolve-app-for-reset-token', () => ({
  resolveAppForResetToken: jest.fn(),
}));

import { PasswordPolicyController } from './password-policy.controller';

describe('PasswordPolicyController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the global policy when resetToken is omitted', async () => {
    const controller = new PasswordPolicyController();
    const result = await controller.get(undefined);
    expect(result.passwordPolicy.minLength).toBe(12);
  });

  it('returns the app-resolved policy for a valid resetToken', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue({
      id: 1,
      passwordPolicyOverride: { minLength: 20, requireUppercase: false, requireLowercase: false, requireNumber: false, requireSpecial: false, minNumbers: 0, minSpecial: 0 },
    });
    const controller = new PasswordPolicyController();
    const result = await controller.get('tok');
    expect(result.passwordPolicy.minLength).toBe(20);
  });

  it('falls back to the global policy for an unresolvable resetToken', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue(null);
    const controller = new PasswordPolicyController();
    const result = await controller.get('bad-tok');
    expect(result.passwordPolicy.minLength).toBe(12);
  });

  it('includes the 4 background color overrides for a valid resetToken', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue({
      id: 1,
      passwordPolicyOverride: null,
      pageLightBackgroundColor: '#111111',
      pageDarkBackgroundColor: '#222222',
      cardLightBackgroundColor: '#333333',
      cardDarkBackgroundColor: '#444444',
    });
    const controller = new PasswordPolicyController();
    const result = await controller.get('tok');
    expect(result.pageLightBackgroundColor).toBe('#111111');
    expect(result.pageDarkBackgroundColor).toBe('#222222');
    expect(result.cardLightBackgroundColor).toBe('#333333');
    expect(result.cardDarkBackgroundColor).toBe('#444444');
  });

  it('returns all-null background colors when resetToken is omitted', async () => {
    const controller = new PasswordPolicyController();
    const result = await controller.get(undefined);
    expect(result.pageLightBackgroundColor).toBeNull();
    expect(result.pageDarkBackgroundColor).toBeNull();
    expect(result.cardLightBackgroundColor).toBeNull();
    expect(result.cardDarkBackgroundColor).toBeNull();
  });

  it('includes logo and favicon for a valid resetToken', async () => {
    const { resolveAppForResetToken } = require('./resolve-app-for-reset-token');
    resolveAppForResetToken.mockResolvedValue({
      id: 1,
      passwordPolicyOverride: null,
      pageLightBackgroundColor: null,
      pageDarkBackgroundColor: null,
      cardLightBackgroundColor: null,
      cardDarkBackgroundColor: null,
      logo: 'data:image/png;base64,AAA=',
      favicon: 'data:image/png;base64,FFF=',
    });
    const controller = new PasswordPolicyController();
    const result = await controller.get('tok');
    expect(result.logo).toBe('data:image/png;base64,AAA=');
    expect(result.favicon).toBe('data:image/png;base64,FFF=');
  });

  it('returns null logo and favicon when resetToken is omitted', async () => {
    const controller = new PasswordPolicyController();
    const result = await controller.get(undefined);
    expect(result.logo).toBeNull();
    expect(result.favicon).toBeNull();
  });
});
