import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString() @MinLength(1) @MaxLength(120) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(120) lastName!: string;
  // bug-0169: an unbounded @IsEmail() accepts email addresses larger
  // than any real inbox; cap to a defensible length so a client bug
  // can't produce a runaway payload.
  @IsEmail() @MaxLength(320) email!: string;
  @IsString() @IsNotEmpty() orgId!: string;
  @IsString() @IsOptional() @MinLength(1) @MaxLength(120) username?: string;
  @IsString() @IsOptional() @MinLength(1) @MaxLength(40) phoneNumber?: string;

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsString({ each: true })
  roleIds?: string[];

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsString({ each: true })
  directPermissionIds?: string[];
}
