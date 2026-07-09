import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Lowercase dotted segments: lowercase letter start, [a-z0-9]+ body,
// >=2 segments joined by dots. Accepts: apps.read, platform.users.manage,
// org.users.manage. Rejects: Apps.read, 1apps.read, apps, apps_read.
const NAME_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$/;

export class CreatePermissionDto {
  @IsString() @MinLength(3) @MaxLength(120) @Matches(NAME_REGEX, { message: 'name must be lowercase dotted segments (e.g. apps.read)' })
  name!: string;

  @IsString() @MinLength(1) @MaxLength(40)
  appId!: string;
}
