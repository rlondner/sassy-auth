import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// "name required when patching" is enforced server-side in
// OrgsService.updateOrg, mirroring the apps approach (avoids the
// bypassable ValidateIf trick under whitelist:true).
export class UpdateOrgDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
}
