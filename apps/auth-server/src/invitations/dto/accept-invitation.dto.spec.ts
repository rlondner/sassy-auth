import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AcceptInvitationDto } from './accept-invitation.dto';

function validate(password: unknown) {
  const dto = plainToInstance(AcceptInvitationDto, { password });
  return validateSync(dto);
}

describe('AcceptInvitationDto', () => {
  it('accepts a strong 12+ char password with all required classes', () => {
    const errors = validate('Str0ngPassword!');
    expect(errors).toHaveLength(0);
  });

  it('rejects a password shorter than 12 chars', () => {
    const errors = validate('Sh0rt!');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a 12-char password without an uppercase letter', () => {
    const errors = validate('alllower1234');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a 12-char password without a lowercase letter', () => {
    const errors = validate('ALLUPPER1234');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a 12-char password without a digit', () => {
    const errors = validate('NoDigitsHere!');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string password', () => {
    const errors = validate(12345678901234);
    expect(errors.length).toBeGreaterThan(0);
  });
});
