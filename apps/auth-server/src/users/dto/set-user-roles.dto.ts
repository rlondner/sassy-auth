import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class SetUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds: string[];
}
