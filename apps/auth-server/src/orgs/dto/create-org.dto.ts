import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOrgDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(1) appId!: string;
}
