import { IsString, IsNotEmpty, IsUrl, IsOptional } from 'class-validator';

export class OauthTokenExchangeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** sa_app.publicId — must match the app that requested the code. */
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  /** PKCE code verifier — the plaintext that was used to derive the
   *  code_challenge sent on the authorize call. Optional: a confidential
   *  client may omit PKCE entirely and authenticate with a client secret
   *  instead (Task 9). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code_verifier?: string;

  @IsUrl({ require_tld: false })
  redirect_uri!: string;

  /** `client_secret_post` — the plaintext client secret, when the client
   *  authenticates via the request body instead of an Authorization: Basic
   *  header (`client_secret_basic`). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  client_secret?: string;
}
