import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
  // The original /authorize URL the admin /signup page was bounced here
  // from, when there was one. Recovered (never trusted blindly) by
  // RegistrationService to bind the signup-flow redirect code to the same
  // PKCE challenge/state/nonce the relying party is waiting on — see
  // docs/superpowers/specs/2026-09-23-signup-pkce-redirect-design.md.
  @IsString() @IsOptional() @MinLength(1) next?: string;
}
