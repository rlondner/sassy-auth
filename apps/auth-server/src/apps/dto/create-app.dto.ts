import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class CreateAppDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] }) @MaxLength(2048) url: string;
}
