// apps/auth-server/src/apps/dto/update-app.dto.ts
import { IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateAppDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(2048) url?: string;

  // At least one field must be present. ValidateIf forces the validation
  // engine to run a custom rule; we use a dummy required string that is
  // only required when both name and url are undefined.
  @ValidateIf((o: UpdateAppDto) => o.name === undefined && o.url === undefined)
  @IsString({ message: 'At least one of name or url must be provided' })
  readonly _atLeastOne?: string;
}
