import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class OauthTokenExchangeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** sa_app.publicId — must match the app that requested the code. */
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  /** PKCE code verifier — the plaintext that was used to derive the
   *  code_challenge sent on the authorize call. */
  @IsString()
  @IsNotEmpty()
  code_verifier!: string;

  @IsUrl({ require_tld: false })
  redirect_uri!: string;
}
