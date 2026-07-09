import { ArrayMaxSize, ArrayUnique, IsArray, IsString } from 'class-validator';

// bug-0034: cap the incoming array at 100. Same reasoning as
// SetUserRolesDto — the admin picker never sends this many, so the
// cap is a defense against a runaway client payload.
const MAX_SET_REPLACE_IDS = 100;

export class SetUserDirectPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_SET_REPLACE_IDS)
  @IsString({ each: true })
  permissionIds!: string[];
}
