import { IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PasswordPolicy, ActivationEmailBranding } from '@sassy-auth/types';
import { IsAppUrl } from '../../common/config/is-app-url.decorator';
import { IsAppLogo } from '../../common/config/is-app-logo.decorator';

// "At least one of name / url" is enforced server-side in
// AppsService.updateApp rather than in a DTO-level ValidateIf trick (which is
// bypassable when whitelist:true is set on ValidationPipe).
export class UpdateAppDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsAppUrl() @MaxLength(2048) url?: string;

  /**
   * Full data URI (e.g. "data:image/png;base64,..."), validated by
   * IsAppLogo against the shared @sassy-auth/types size/type rule.
   * `null` clears the logo.
   */
  @IsOptional()
  @IsAppLogo()
  logo?: string | null;

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

  @IsOptional() @IsBoolean() allowOfflineAccess?: boolean;

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

  /**
   * Target URL for the activation webhook (see
   * apps/auth-server/src/activation/notify-activation.ts). null clears it,
   * which stops delivery — the account still activates normally, it just
   * isn't reported to this app anymore.
   */
  @IsOptional() @IsAppUrl() @MaxLength(2048) webhookUrl?: string | null;

  /**
   * URL to this app's Privacy Policy. When set, self-serve signup and every
   * login path require the user to accept it before reaching the app (see
   * consent/resolve-required-consent.ts). null clears it.
   */
  @IsOptional() @IsAppUrl() @MaxLength(2048) privacyPolicyUrl?: string | null;

  /** URL to this app's Terms and Conditions. Same acceptance rule as privacyPolicyUrl. */
  @IsOptional() @IsAppUrl() @MaxLength(2048) termsUrl?: string | null;

  /**
   * URL to this app's GDPR disclosure. Acceptance is additionally
   * conditional on geo-detected applicability — see
   * consent/resolve-required-consent.ts.
   */
  @IsOptional() @IsAppUrl() @MaxLength(2048) gdprUrl?: string | null;

  /**
   * Per-app override for the activation email's subject/message/from (see
   * @sassy-auth/types ActivationEmailBranding). Deep-validated in
   * AppsService.assertValidActivationEmailOverride, following the same
   * manual-validation-in-service pattern as passwordPolicyOverride above.
   * null clears the override, reverting every field to the platform default.
   */
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  activationEmailOverride?: ActivationEmailBranding | null;
}
