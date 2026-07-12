import { IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsAppUrl } from '../../common/config/is-app-url.decorator';

export class CreateAppDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsAppUrl() @MaxLength(2048) url!: string;

  // Optional exact-match callback URL. Omitted / null / '' all mean "default"
  // (origin match against `url`) and skip validation.
  @ValidateIf((o) => o.callbackUrl !== undefined && o.callbackUrl !== null && o.callbackUrl !== '')
  @IsAppUrl()
  @MaxLength(2048)
  callbackUrl?: string | null;

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
}
