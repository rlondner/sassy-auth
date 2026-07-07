import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// At least 12 chars, with at least one upper, one lower, one digit.
// Symbols are not required but allowed.
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/;

export class AcceptInvitationDto {
  @IsString()
  @MinLength(12)
  // bug-0184: bound the accept-invite password just like direct-login
  // (bug-0192). This endpoint is unauthenticated and runs scrypt via
  // BetterAuth on submit; an attacker submitting a multi-megabyte
  // password otherwise burns CPU on the auth-server per request.
  @MaxLength(256)
  @Matches(PASSWORD_PATTERN, {
    message:
      'Password must be at least 12 characters and contain an uppercase letter, a lowercase letter, and a digit.',
  })
  password!: string;
}
