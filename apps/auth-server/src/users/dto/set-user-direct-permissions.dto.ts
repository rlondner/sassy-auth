import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class SetUserDirectPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionIds: string[];
}
