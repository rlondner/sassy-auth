import { BadRequestException } from '@nestjs/common';
import { PasswordPolicy } from '@sassy-auth/types';
import {
  MAX_PASSWORD_LENGTH,
  getGlobalPasswordPolicy,
  resolvePasswordPolicy,
  validatePasswordOrThrow,
} from './password-policy';

describe('getGlobalPasswordPolicy', () => {
  it('returns the bug-0280-compatible defaults when no env vars are set', () => {
    expect(getGlobalPasswordPolicy({})).toEqual<PasswordPolicy>({
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: false,
      minNumbers: 1,
      minSpecial: 0,
    });
  });

  it('reads every knob from its env var when set', () => {
    const env = {
      PASSWORD_MIN_LENGTH: '16',
      PASSWORD_REQUIRE_UPPERCASE: 'false',
      PASSWORD_REQUIRE_LOWERCASE: 'true',
      PASSWORD_REQUIRE_NUMBER: 'true',
      PASSWORD_REQUIRE_SPECIAL: 'true',
      PASSWORD_MIN_NUMBERS: '2',
      PASSWORD_MIN_SPECIAL: '1',
    };
    expect(getGlobalPasswordPolicy(env)).toEqual<PasswordPolicy>({
      minLength: 16,
      requireUppercase: false,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: true,
      minNumbers: 2,
      minSpecial: 1,
    });
  });
});

describe('resolvePasswordPolicy', () => {
  const env = {};

  it('returns the global policy when passwordPolicyOverride is null', () => {
    const app = { passwordPolicyOverride: null };
    expect(resolvePasswordPolicy(app, env)).toEqual(getGlobalPasswordPolicy(env));
  });

  it('returns the override verbatim when present', () => {
    const override: PasswordPolicy = {
      minLength: 20,
      requireUppercase: false,
      requireLowercase: false,
      requireNumber: false,
      requireSpecial: true,
      minNumbers: 0,
      minSpecial: 3,
    };
    const app = { passwordPolicyOverride: override };
    expect(resolvePasswordPolicy(app, env)).toEqual(override);
  });
});

describe('validatePasswordOrThrow', () => {
  const policy: PasswordPolicy = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: false,
    minNumbers: 1,
    minSpecial: 0,
  };

  it('does not throw for a password that satisfies the policy', () => {
    expect(() => validatePasswordOrThrow('Str0ngPassword', policy)).not.toThrow();
  });

  it('throws BadRequestException with every failed rule when the policy is violated', () => {
    try {
      validatePasswordOrThrow('short', policy);
      fail('expected validatePasswordOrThrow to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const response = (e as BadRequestException).getResponse() as {
        errorKey: string;
        failedRules: string[];
      };
      expect(response.errorKey).toBe('password.policyViolation');
      expect(response.failedRules).toEqual(
        expect.arrayContaining(['minLength', 'requireUppercase', 'requireNumber']),
      );
    }
  });

  it('throws when the password exceeds MAX_PASSWORD_LENGTH regardless of policy', () => {
    const longPassword = 'Aa1'.repeat(100); // 300 chars, satisfies every complexity rule
    expect(longPassword.length).toBeGreaterThan(MAX_PASSWORD_LENGTH);
    try {
      validatePasswordOrThrow(longPassword, policy);
      fail('expected validatePasswordOrThrow to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const response = (e as BadRequestException).getResponse() as { failedRules: string[] };
      expect(response.failedRules).toContain('maxLength');
    }
  });
});
