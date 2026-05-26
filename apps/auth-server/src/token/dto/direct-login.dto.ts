import { IsString, IsNotEmpty } from 'class-validator';

export class DirectLoginDto {
  /** Username, email address, or phone number. */
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  /** sa_app.publicId of the app the user is authenticating for. */
  @IsString()
  @IsNotEmpty()
  appId!: string;
}
