import { IsString, IsNotEmpty, IsUrl, IsOptional, IsIn, ValidateIf } from 'class-validator';

export class OauthTokenExchangeDto {
  /** RFC 6749 §4.1.3 / §6 — every token request names its grant type.
   *  This server supports the authorization_code grant (matching
   *  `grant_types_supported` in the discovery documents) and refresh_token. */
  @IsIn(['authorization_code', 'refresh_token'])
  grant_type!: string;

  /** Required for grant_type=authorization_code; absent for refresh_token. */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'authorization_code')
  @IsString()
  @IsNotEmpty()
  code?: string;

  /** sa_app.publicId — must match the app that requested the code, or that
   *  the refresh token was issued to. */
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  /** PKCE code verifier — the plaintext that was used to derive the
   *  code_challenge sent on the authorize call. Optional: a confidential
   *  client may omit PKCE entirely and authenticate with a client secret
   *  instead (Task 9). Not used for grant_type=refresh_token. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code_verifier?: string;

  /** Required for grant_type=authorization_code; absent for refresh_token. */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'authorization_code')
  @IsUrl({ require_tld: false })
  redirect_uri?: string;

  /** `client_secret_post` — the plaintext client secret, when the client
   *  authenticates via the request body instead of an Authorization: Basic
   *  header (`client_secret_basic`). Applies to both grant types. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  client_secret?: string;

  /** Required for grant_type=refresh_token — the opaque refresh token to
   *  redeem and rotate. */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'refresh_token')
  @IsString()
  @IsNotEmpty()
  refresh_token?: string;
}
