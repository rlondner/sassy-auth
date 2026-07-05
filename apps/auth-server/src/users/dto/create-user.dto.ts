import { ArrayUnique, IsArray, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @IsNotEmpty() orgId: string;
  @IsString() @IsOptional() username?: string;
  @IsString() @IsOptional() phoneNumber?: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  roleIds?: string[];

  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  directPermissionIds?: string[];
}
