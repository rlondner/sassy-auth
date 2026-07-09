import { ArrayUnique, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @IsString() @MinLength(1) @MaxLength(40)
  appId!: string;

  // Optional list of permission publicIds to assign on create. Each id must be
  // a permission whose own appId matches the role's appId (service enforces).
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  permissionIds?: string[];
}
