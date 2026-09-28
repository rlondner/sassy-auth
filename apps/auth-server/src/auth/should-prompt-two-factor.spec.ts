import { shouldPromptTwoFactor } from './should-prompt-two-factor';

describe('shouldPromptTwoFactor', () => {
  const NOW = new Date('2026-07-12T12:00:00Z');
  const INTERVAL_DAYS = 14;

  it('returns true when twoFactorEnabled is false and promptedAt is null', () => {
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: null, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(true);
  });

  it('returns false when twoFactorEnabled is true (already enrolled)', () => {
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: true, promptedAt: null, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(false);
  });

  it('returns false when promptedAt is within the interval', () => {
    const recentlyPrompted = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: recentlyPrompted, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(false);
  });

  it('returns false when promptedAt is exactly at the interval boundary', () => {
    const exactBoundary = new Date(NOW.getTime() - INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: exactBoundary, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(false);
  });

  it('returns true when promptedAt is older than the interval', () => {
    const longAgo = new Date(NOW.getTime() - (INTERVAL_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: longAgo, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(true);
  });

  it('returns true when intervalDays is 0 (prompt every time)', () => {
    const justNow = new Date(NOW.getTime() - 1);
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: justNow, now: NOW, intervalDays: 0, promptEnabled: true }),
    ).toBe(true);
  });

  it('returns false when promptEnabled is false, even if never prompted', () => {
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: null, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: false }),
    ).toBe(false);
  });

  it('returns false when promptEnabled is false, even if the interval elapsed', () => {
    const longAgo = new Date(NOW.getTime() - (INTERVAL_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: longAgo, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: false }),
    ).toBe(false);
  });

  it('returns true when promptEnabled is true and all other conditions are met', () => {
    expect(
      shouldPromptTwoFactor({ twoFactorEnabled: false, promptedAt: null, now: NOW, intervalDays: INTERVAL_DAYS, promptEnabled: true }),
    ).toBe(true);
  });
});
