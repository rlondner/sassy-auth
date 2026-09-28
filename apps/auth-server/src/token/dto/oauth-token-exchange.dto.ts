import { IsString, IsNotEmpty, IsUrl, IsOptional, IsIn, ValidateIf } from 'class-validator';

export class OauthTokenExchangeDto {
  /** RFC 6749 §4.1.3 / §4.4 / §6 requires every token request to name its
   *  grant type. `client_credentials` (RFC 6749 §4.4) mints a service token
   *  for a confidential app acting as itself — see
   *  docs/superpowers/specs/2026-09-17-service-client-credentials-design.md §4. */
  @IsIn(['authorization_code', 'client_credentials', 'refresh_token'])
  grant_type!: string;

  /** Required for authorization_code; meaningless for client_credentials and
   *  refresh_token (ValidateIf skips validation entirely for the other grant
   *  types, so an omitted field there is not an error). */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'authorization_code')
  @IsString()
  @IsNotEmpty()
  code?: string;

  /** sa_app.publicId — must match the app that requested the code, the app
   *  the refresh token was issued to, or (for client_credentials) the app
   *  authenticating itself. */
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  /** PKCE code verifier — the plaintext that was used to derive the
   *  code_challenge sent on the authorize call. Optional: a confidential
   *  client may omit PKCE entirely and authenticate with a client secret
   *  instead (Task 9). Not used by client_credentials or refresh_token. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code_verifier?: string;

  /** Required for authorization_code; meaningless for client_credentials and
   *  refresh_token. */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'authorization_code')
  @IsUrl({ require_tld: false })
  redirect_uri?: string;

  /** `client_secret_post` — the plaintext client secret, when the client
   *  authenticates via the request body instead of an Authorization: Basic
   *  header (`client_secret_basic`). Used by authorization_code (confidential
   *  clients) and client_credentials (always confidential); irrelevant to
   *  refresh_token. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  client_secret?: string;

  /** Space-delimited requested scopes. Only meaningful for
   *  client_credentials — parsed against the service-scope vocabulary
   *  (token/service-scopes.ts), not the OIDC SUPPORTED_SCOPES. */
  @IsOptional()
  @IsString()
  scope?: string;

  /** Required for grant_type=refresh_token — the opaque refresh token to
   *  redeem and rotate. */
  @ValidateIf((o: OauthTokenExchangeDto) => o.grant_type === 'refresh_token')
  @IsString()
  @IsNotEmpty()
  refresh_token?: string;
}
