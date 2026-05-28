import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

// "At least one of name or url" is enforced server-side in AppsService.updateApp
// rather than in a DTO-level ValidateIf trick (which is bypassable when
// whitelist:true is set on ValidationPipe).
export class UpdateAppDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['https', 'http'] }) @MaxLength(2048) url?: string;
}
