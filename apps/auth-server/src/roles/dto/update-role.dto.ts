import { ArrayUnique, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// appId is intentionally NOT in this DTO. With whitelist:true at the
// ValidationPipe (the project default), any appId sent in the body is
// stripped. Service throws BadRequest if neither name nor permissionIds
// is supplied.
export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  // When provided, REPLACES the entire permission set with this list.
  // Each id must be a permission whose own appId matches the role's appId.
  // Pass [] to clear all permissions.
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  permissionIds?: string[];
}
