import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const NAME_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$/;

// appId is intentionally NOT in this DTO. With whitelist:true at the
// ValidationPipe (the project default), any appId sent in the body is
// stripped. Service still throws BadRequest if nothing else is supplied.
export class UpdatePermissionDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) @Matches(NAME_REGEX, { message: 'name must be lowercase dotted segments (e.g. apps.read)' })
  name?: string;
}
