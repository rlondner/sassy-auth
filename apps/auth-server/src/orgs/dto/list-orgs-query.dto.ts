import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListOrgsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number = 25;

  @IsOptional() @IsString() @MaxLength(200)
  q?: string;

  @IsOptional() @IsString() @MaxLength(40)
  appId?: string;
}
