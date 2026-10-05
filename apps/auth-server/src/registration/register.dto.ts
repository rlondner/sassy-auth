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
  // The original /authorize URL the admin /signup page was bounced here
  // from, when there was one. Recovered (never trusted blindly) by
  // RegistrationService to bind the signup-flow redirect code to the same
  // PKCE challenge/state/nonce the relying party is waiting on — see
  // docs/superpowers/specs/2026-09-23-signup-pkce-redirect-design.md.
  @IsString() @IsOptional() @MinLength(1) @MaxLength(4096) next?: string;
}

export class StartRegistrationDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) appPublicId!: string;
  @IsString() @MinLength(1) turnstileToken!: string;
}

export class VerifyRegistrationCodeDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(6) otp!: string;
}

export class CompleteRegistrationDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(6) otp!: string;
  // Complexity is policy-driven, same as RegisterDto.password — the DTO
  // only guards shape and the fixed DoS-prevention length cap.
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsString() @IsOptional() @MinLength(1) companyName?: string;
  @IsString() @MinLength(1) appPublicId!: string;
  @IsOptional() @IsBoolean() acceptedPrivacyPolicy?: boolean;
  @IsOptional() @IsBoolean() acceptedTerms?: boolean;
  @IsOptional() @IsBoolean() acceptedGdpr?: boolean;
  @IsOptional() @IsBoolean() marketingOptIn?: boolean;
  // Same PKCE-redirect-recovery field as RegisterDto.next — see its comment.
  @IsString() @IsOptional() @MinLength(1) @MaxLength(4096) next?: string;
}
