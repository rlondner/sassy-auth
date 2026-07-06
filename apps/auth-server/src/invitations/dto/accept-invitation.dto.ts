import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// At least 12 chars, with at least one upper, one lower, one digit.
// Symbols are not required but allowed.
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/;

export class AcceptInvitationDto {
  @IsString()
  @MaxLength(256)
  @MinLength(12)
  @Matches(PASSWORD_PATTERN, {
    message:
      'Password must be at least 12 characters and contain an uppercase letter, a lowercase letter, and a digit.',
  })
  password: string;
}
