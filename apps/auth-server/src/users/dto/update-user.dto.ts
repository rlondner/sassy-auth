import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
  // bug-0168: `IsOptional` on its own allowed the field to be either
  // MISSING or the empty string; class-validator does not treat
  // empty-string as "skip." The empty-string case would then WRITE
  // empty-string to firstName/lastName in the DB, corrupting the row.
  // Adding `@MinLength(1)` alongside `@IsOptional` means "omit the
  // field OR send a non-empty value." MaxLength mirrors CreateUserDto
  // so the two DTOs share the same field-shape constraints.
  @IsString() @IsOptional() @MinLength(1) @MaxLength(120) firstName?: string;
  @IsString() @IsOptional() @MinLength(1) @MaxLength(120) lastName?: string;
  @IsString() @IsOptional() @MinLength(1) @MaxLength(40) phoneNumber?: string;
  @IsString() @IsOptional() @MinLength(1) @MaxLength(120) username?: string;
  @IsEnum(['active', 'inactive']) @IsOptional() status?: 'active' | 'inactive';
}
