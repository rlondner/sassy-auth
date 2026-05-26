import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @IsString() @IsOptional() firstName?: string;
  @IsString() @IsOptional() lastName?: string;
  @IsString() @IsOptional() phoneNumber?: string;
  @IsString() @IsOptional() username?: string;
  @IsEnum(['active', 'inactive']) @IsOptional() status?: 'active' | 'inactive';
}
