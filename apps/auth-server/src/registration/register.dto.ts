import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;
  // Complexity is policy-driven and enforced by RegistrationService via
  // resolvePasswordPolicy/validatePasswordOrThrow (see ../auth/password-policy)
  // — the DTO only guards shape and the fixed DoS-prevention length cap.
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsString() @IsOptional() @MinLength(1) companyName?: string;
  @IsString() @MinLength(1) appPublicId!: string;
  @IsString() @MinLength(1) turnstileToken!: string;
  /** Required (must be `true`) iff the target app has privacyPolicyUrl set. */
  @IsOptional() @IsBoolean() acceptedPrivacyPolicy?: boolean;
  /** Required (must be `true`) iff the target app has termsUrl set. */
  @IsOptional() @IsBoolean() acceptedTerms?: boolean;
  /** Required (must be `true`) iff the target app has gdprUrl set AND the
   * request is geo-detected as GDPR-applicable. */
  @IsOptional() @IsBoolean() acceptedGdpr?: boolean;
}
