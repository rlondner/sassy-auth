import { IsString, IsNotEmpty, IsUrl, IsOptional, IsIn } from 'class-validator';

export class OauthTokenExchangeDto {
  /** RFC 6749 §4.1.3 requires every token request to name its grant type.
   *  The global ValidationPipe's `forbidNonWhitelisted` rejected this field
   *  outright until it was declared here — any spec-compliant client sends
   *  it, so every real client's exchange was a 400 (found by Task 12's e2e
   *  proof). This server supports exactly one grant, matching
   *  `grant_types_supported` in both discovery documents. */
  @IsIn(['authorization_code'])
  grant_type!: string;

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
