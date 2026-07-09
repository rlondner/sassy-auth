import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsAppUrl } from '../../common/config/is-app-url.decorator';

// "At least one of name / url / callbackUrl" is enforced server-side in
// AppsService.updateApp rather than in a DTO-level ValidateIf trick (which is
// bypassable when whitelist:true is set on ValidationPipe).
export class UpdateAppDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsAppUrl() @MaxLength(2048) url?: string;

  // Omitted = leave unchanged. '' or null = clear back to "default".
  @ValidateIf((o) => o.callbackUrl !== undefined && o.callbackUrl !== null && o.callbackUrl !== '')
  @IsAppUrl()
  @MaxLength(2048)
  callbackUrl?: string | null;
}
