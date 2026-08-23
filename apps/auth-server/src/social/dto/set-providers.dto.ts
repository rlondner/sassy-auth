import { IsArray, IsOptional, IsString } from 'class-validator';

// Unlike every other mutating admin route (CreateAppDto, UpdateAppDto), the
// original PUT here took a bare `{ providers?: string[] }` TypeScript type.
// Under the project's global ValidationPipe({ whitelist: true,
// forbidNonWhitelisted: true, transform: true }), a bare type performs no
// validation at all — a malformed body (wrong shape, non-string entries)
// would reach SocialService.setForApp and be silently mishandled instead of
// being rejected at the edge with a 400.
export class SetProvidersDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  providers?: string[];
}
