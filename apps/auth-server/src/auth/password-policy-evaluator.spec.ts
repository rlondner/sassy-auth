import { evaluatePasswordPolicy, PasswordPolicy } from '@sassy-auth/types';

const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
};

function failedRules(password: string, policy: PasswordPolicy): string[] {
  return evaluatePasswordPolicy(password, policy)
    .filter((r) => !r.met)
    .map((r) => r.rule);
}

describe('evaluatePasswordPolicy', () => {
  it('passes a password meeting every default-policy rule', () => {
    expect(failedRules('Str0ngPassword', DEFAULT_POLICY)).toEqual([]);
  });

  it('fails minLength for a short password', () => {
    expect(failedRules('Sh0rt', DEFAULT_POLICY)).toContain('minLength');
  });

  it('fails requireUppercase when there is no uppercase letter', () => {
    expect(failedRules('alllowercase123', DEFAULT_POLICY)).toContain('requireUppercase');
  });

  it('fails requireLowercase when there is no lowercase letter', () => {
    expect(failedRules('ALLUPPERCASE123', DEFAULT_POLICY)).toContain('requireLowercase');
  });

  it('fails requireNumber when there is no digit', () => {
    expect(failedRules('NoDigitsHereABC', DEFAULT_POLICY)).toContain('requireNumber');
  });

  it('does not require special characters when requireSpecial is false', () => {
    expect(failedRules('NoSpecialChars123', DEFAULT_POLICY)).toEqual([]);
  });

  it('fails requireSpecial when the policy requires one and none is present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, requireSpecial: true };
    expect(failedRules('NoSpecialChars123', policy)).toContain('requireSpecial');
  });

  it('passes requireSpecial when a special character is present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, requireSpecial: true };
    expect(failedRules('HasSpecial123!', policy)).toEqual([]);
  });

  it('fails minNumbers when fewer digits than required are present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, minNumbers: 3 };
    expect(failedRules('OnlyOneDigit1', policy)).toContain('minNumbers');
  });

  it('passes minNumbers when enough digits are present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, minNumbers: 3 };
    expect(failedRules('ThreeDigits123', policy)).toEqual([]);
  });

  it('fails minSpecial when fewer special characters than required are present', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, requireSpecial: true, minSpecial: 2 };
    expect(failedRules('OnlyOneSpecial1!', policy)).toContain('minSpecial');
  });

  it('reports every failed rule at once, not just the first', () => {
    const policy: PasswordPolicy = { ...DEFAULT_POLICY, requireSpecial: true };
    const failed = failedRules('short', policy);
    expect(failed).toEqual(
      expect.arrayContaining(['minLength', 'requireUppercase', 'requireNumber', 'requireSpecial']),
    );
  });
});
