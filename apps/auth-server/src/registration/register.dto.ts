import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

// bug-0280: mirrors the policy bug-0007 established for AcceptInvitationDto
// (apps/auth-server/src/invitations/dto/accept-invitation.dto.ts) — at least
// 12 chars, with at least one upper, one lower, one digit. Symbols are not
// required but allowed. RegisterDto is a newer endpoint (self-serve signup)
// that had regressed to the pre-bug-0007 8-char-only floor, letting a caller
// hitting POST /api/register directly bypass the admin console's stricter
// client-side policy entirely.
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/;

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString()
  @MinLength(12)
  @Matches(PASSWORD_PATTERN, {
    message:
      'Password must be at least 12 characters and contain an uppercase letter, a lowercase letter, and a digit.',
  })
  password!: string;
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsString() @MinLength(1) companyName!: string;
  @IsString() @MinLength(1) appPublicId!: string;
}
