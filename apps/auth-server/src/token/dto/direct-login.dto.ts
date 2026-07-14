import { IsString, IsNotEmpty, MaxLength, IsOptional, MinLength } from 'class-validator';

export class DirectLoginDto {
  /** Username, email address, or phone number. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  identifier!: string;

  // Bounded to prevent scrypt hash-DoS on this unauthenticated endpoint.
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;

  /** sa_app.publicId of the app the user is authenticating for. */
  @IsString()
  @IsNotEmpty()
  appId!: string;

  /**
   * Optional 6-digit TOTP code. Required when the target app enforces 2FA or the
   * user has 2FA enabled. Bounded to 6 chars; never logged.
   */
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  totpCode?: string;
}
