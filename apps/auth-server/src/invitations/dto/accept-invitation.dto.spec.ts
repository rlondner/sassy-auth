import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AcceptInvitationDto } from './accept-invitation.dto';

function validate(password: unknown) {
  const dto = plainToInstance(AcceptInvitationDto, { password });
  return validateSync(dto).filter((e) => e.property === 'password');
}

// Complexity is now policy-driven and resolved per-invitation's app in
// InvitationsService — see invitations.service.spec.ts. The DTO only guards
// shape and the fixed DoS-prevention length cap (bug-0184).
describe('AcceptInvitationDto password field', () => {
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
});
