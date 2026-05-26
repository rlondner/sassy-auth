import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
  @IsEmail() email: string;
  @IsString() orgId: string;           // public ID (Sqid)
  @IsString() @IsOptional() username?: string;
  @IsString() @IsOptional() phoneNumber?: string;
}
