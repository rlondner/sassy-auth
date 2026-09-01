import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength, ValidateIf } from 'class-validator';
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
}
