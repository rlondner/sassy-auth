import { IsString, MaxLength, MinLength } from 'class-validator';

// Complexity is policy-driven — resolved per-invitation's app and enforced
// in InvitationsService via validatePasswordOrThrow. MaxLength(256) is the
// fixed DoS-prevention cap (bug-0184), shared by every password-setting
// surface (see password-policy.ts's MAX_PASSWORD_LENGTH).
export class AcceptInvitationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
