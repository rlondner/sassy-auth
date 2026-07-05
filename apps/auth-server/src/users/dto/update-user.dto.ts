import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsString() @MinLength(1) @IsOptional() firstName?: string;
  @IsString() @MinLength(1) @IsOptional() lastName?: string;
  @IsString() @MinLength(1) @IsOptional() phoneNumber?: string;
  @IsString() @MinLength(1) @IsOptional() username?: string;
  @IsEnum(['active', 'inactive']) @IsOptional() status?: 'active' | 'inactive';
}
