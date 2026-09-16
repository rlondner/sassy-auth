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
}
