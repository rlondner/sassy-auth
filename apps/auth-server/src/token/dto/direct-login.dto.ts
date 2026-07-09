import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

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
}
