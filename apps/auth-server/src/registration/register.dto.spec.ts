import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterDto } from './register.dto';

const BASE = {
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Wonder',
  companyName: 'Acme Inc',
  appPublicId: 'sq_1',
};

function validate(password: unknown) {
  const dto = plainToInstance(RegisterDto, { ...BASE, password });
  return validateSync(dto).filter((e) => e.property === 'password');
}

// Complexity (length/upper/lower/digit/special) is now policy-driven and
// resolved per-app in RegistrationService — see registration.service.spec.ts.
// The DTO only guards shape and the fixed DoS-prevention length cap.
describe('RegisterDto password field', () => {
  it('accepts any non-empty string up to the max length', () => {
    expect(validate('a')).toHaveLength(0);
  });

  it('rejects an empty password', () => {
    expect(validate('').length).toBeGreaterThan(0);
  });

  it('rejects a password over 256 characters', () => {
    expect(validate('a'.repeat(257)).length).toBeGreaterThan(0);
  });

  it('accepts a password at exactly 256 characters', () => {
    expect(validate('a'.repeat(256))).toHaveLength(0);
  });

  it('rejects a non-string password', () => {
    expect(validate(12345678901234).length).toBeGreaterThan(0);
  });
});
