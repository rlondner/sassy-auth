import { IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PasswordPolicy } from '@sassy-auth/types';
import { IsAppUrl } from '../../common/config/is-app-url.decorator';

// "At least one of name / url" is enforced server-side in
// AppsService.updateApp rather than in a DTO-level ValidateIf trick (which is
// bypassable when whitelist:true is set on ValidationPipe).
export class UpdateAppDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsAppUrl() @MaxLength(2048) url?: string;

  /**
   * Per-app 2FA trust / re-prompt interval in days.
   * null → use system default (TWO_FACTOR_TRUST_DAYS env var, default 14).
   * Must be a positive integer when provided; max 3650 (10 years).
   */
  @IsOptional()
  @ValidateIf((o: UpdateAppDto) => o.twoFactorTrustDays !== null && o.twoFactorTrustDays !== undefined)
  @IsInt()
  @IsPositive()
  @Max(3650)
  twoFactorTrustDays?: number | null;

  @IsOptional() @IsBoolean() requireTwoFactor?: boolean;

  /**
   * publicId of an existing org under this app to auto-join self-serve
   * sign-ups into. Must belong to the same app — validated in AppsService
   * (not expressible as a schema-level FK constraint). `null` clears it.
   */
  @IsOptional() @IsString() defaultOrgId?: string | null;

  /**
   * publicId of an existing role under this app to auto-assign to self-serve
   * sign-ups. Must belong to the same app — validated in AppsService.
   * `null` clears it.
   */
  @IsOptional() @IsString() defaultRoleId?: string | null;

  /**
   * Registered login / post_logout redirect URIs for this app. When present,
   * replaces the app's entire redirect URI set. Validated as absolute
   * http(s) URLs in AppsService — see assertValidRedirectUris.
   */
  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  redirectUris?: Array<{ uri: string; kind: 'login' | 'post_logout' }>;

  /**
   * Complete PasswordPolicy override for this app's users (register,
   * accept-invite, forgot-password reset). null clears the override,
   * reverting to the global env-derived policy. Deep-validated in
   * AppsService.assertValidPasswordPolicyOverride, following the same
   * manual-validation-in-service pattern as redirectUris above.
   */
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  passwordPolicyOverride?: PasswordPolicy | null;
}
