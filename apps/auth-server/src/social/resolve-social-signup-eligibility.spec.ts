import { resolveSocialSignupEligibility } from './resolve-social-signup-eligibility';

describe('resolveSocialSignupEligibility', () => {
  it('is eligible when both defaultOrgId and defaultRoleId are set', () => {
    expect(resolveSocialSignupEligibility({ defaultOrgId: 1, defaultRoleId: 2 })).toBe(true);
  });

  it('is ineligible when defaultOrgId is null', () => {
    expect(resolveSocialSignupEligibility({ defaultOrgId: null, defaultRoleId: 2 })).toBe(false);
  });

  it('is ineligible when defaultRoleId is null', () => {
    expect(resolveSocialSignupEligibility({ defaultOrgId: 1, defaultRoleId: null })).toBe(false);
  });

  it('is ineligible when both are null', () => {
    expect(resolveSocialSignupEligibility({ defaultOrgId: null, defaultRoleId: null })).toBe(false);
  });

  // Design §1: no isPlatform carve-out — eligibility is identical for the
  // platform app and every other app.
  it('does not treat isPlatform specially', () => {
    expect(
      resolveSocialSignupEligibility({ defaultOrgId: 1, defaultRoleId: 2, isPlatform: true }),
    ).toBe(true);
  });
});
