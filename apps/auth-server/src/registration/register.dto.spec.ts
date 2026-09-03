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

// bug-0280: RegisterDto had regressed to the pre-bug-0007 @MinLength(8)-only
// password policy. These mirror invitations/dto/accept-invitation.dto.spec.ts.
describe('RegisterDto password policy', () => {
  it('accepts a strong 12+ char password with all required classes', () => {
    expect(validate('Str0ngPassword!')).toHaveLength(0);
  });

  it('rejects a password shorter than 12 chars', () => {
    expect(validate('Sh0rt!').length).toBeGreaterThan(0);
  });

  it('rejects an 8-char password that satisfied the old policy', () => {
    expect(validate('Pass123!').length).toBeGreaterThan(0);
  });

  it('rejects a 12-char password without an uppercase letter', () => {
    expect(validate('alllower1234').length).toBeGreaterThan(0);
  });

  it('rejects a 12-char password without a lowercase letter', () => {
    expect(validate('ALLUPPER1234').length).toBeGreaterThan(0);
  });

  it('rejects a 12-char password without a digit', () => {
    expect(validate('NoDigitsHere!').length).toBeGreaterThan(0);
  });

  it('rejects a non-string password', () => {
    expect(validate(12345678901234).length).toBeGreaterThan(0);
  });
});
