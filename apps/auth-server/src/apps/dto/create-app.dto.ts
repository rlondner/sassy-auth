import { IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsAppUrl } from '../../common/config/is-app-url.decorator';

export class CreateAppDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsAppUrl() @MaxLength(2048) url!: string;

  /**
   * Per-app 2FA trust / re-prompt interval in days.
   * null → use system default (TWO_FACTOR_TRUST_DAYS env var, default 14).
   * Must be a positive integer when provided; max 3650 (10 years).
   */
  @IsOptional()
  @ValidateIf((o: CreateAppDto) => o.twoFactorTrustDays !== null && o.twoFactorTrustDays !== undefined)
  @IsInt()
  @IsPositive()
  @Max(3650)
  twoFactorTrustDays?: number | null;

  @IsOptional() @IsBoolean() requireTwoFactor?: boolean;

  /**
   * Registered login / post_logout redirect URIs for this app. Validated as
   * absolute http(s) URLs in AppsService — see assertValidRedirectUris.
   */
  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  redirectUris?: Array<{ uri: string; kind: 'login' | 'post_logout' }>;
}
