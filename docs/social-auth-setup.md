# Social sign-in setup (Google, Microsoft, Apple)

This is the operator-facing setup guide for federated (social) sign-in. It
covers registering an OAuth client with each identity provider and mapping
the console values to SassyAuth's environment variables. For the design
rationale — why sign-in is invite-only, why credentials are deployment-global,
why Apple's secret has no static env var — see
[`docs/superpowers/specs/2026-08-22-social-authentication-design.md`](superpowers/specs/2026-08-22-social-authentication-design.md).

## Before you start

- **Social sign-in is invite-only.** It is a login method, never a signup
  method. A user must already exist as an active `SaUser` (provisioned by an
  admin or via an accepted invitation) before they can sign in with Google,
  Microsoft, or Apple. An unrecognised identity is refused; no user, org, or
  account row is created. First social sign-in *links* the provider identity
  to the existing `SaUser`, matched on `(providerId, sub)` first, and
  otherwise on an email the provider asserts as verified.
- **Credentials are deployment-global, not per-app.** Each provider's
  `clientId`/`clientSecret` pair is one set of environment variables shared by
  the whole deployment. Apps individually opt in or out of *showing* a
  configured provider's button (via the admin console's app settings), but
  they cannot each bring their own OAuth client. Per-app credentials are
  deferred — the data model is shaped to add them later without rework.
- **Every redirect URI follows the same rule:**

  ```
  {BETTER_AUTH_URL}/api/auth/callback/{provider}
  ```

  e.g. `http://localhost:3000/api/auth/callback/google` in local development,
  or `https://auth.example.com/api/auth/callback/microsoft` in production.
  Register exactly this URL with each provider's console.

- **CI needs no real provider credentials.** The end-to-end suite runs against
  a stub OIDC provider the repo owns (registered only when `E2E_STUB_IDP_URL`
  is set and `NODE_ENV` is exactly `test` or `development` — never in
  production, by design). It covers linking, refusal, and the `amr`/`idp`
  claim assertions. The credentials below are needed only to validate the
  three real integrations by hand, and that validation is a prerequisite for
  sign-off, not for the automated tests to pass.

## Google

Free — no paid account required.

1. Google Cloud Console → create or select a project.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   application type **Web application**.
3. Under **OAuth consent screen**, choose **External** and add your own
   address as a test user. While the app stays in "Testing" publishing
   status, no Google verification review is required.
4. Add the redirect URI: `{BETTER_AUTH_URL}/api/auth/callback/google` — for
   local development, plain-HTTP `localhost` is permitted
   (`http://localhost:3000/api/auth/callback/google`).

| Console value  | Env var                |
|----------------|-------------------------|
| Client ID      | `GOOGLE_CLIENT_ID`      |
| Client secret  | `GOOGLE_CLIENT_SECRET`  |

## Microsoft (Entra ID)

Free — no paid account required.

1. Entra admin center → **App registrations → New registration**.
2. Platform type **Web**, redirect URI
   `{BETTER_AUTH_URL}/api/auth/callback/microsoft` (e.g.
   `http://localhost:3000/api/auth/callback/microsoft` locally).
3. **Certificates & secrets → New client secret**. Secrets expire (max
   24-month lifetime) — record the expiry date, since there is no automatic
   renewal for this one (unlike Apple's, which SassyAuth generates itself).

| Portal value                                          | Env var                  |
|--------------------------------------------------------|---------------------------|
| Application (client) ID                                | `MICROSOFT_CLIENT_ID`     |
| Client secret **Value** (not the Secret ID — shown once) | `MICROSOFT_CLIENT_SECRET` |
| Directory (tenant) ID                                   | `MICROSOFT_TENANT_ID`     |

**Pin your tenant.** Set `MICROSOFT_TENANT_ID` to your own directory's ID
rather than leaving Entra's default of `common`. This matters because Entra
does not, by default, emit the `email_verified` (or `verified_primary_email`
/ `verified_secondary_email`) claim that SassyAuth's linking rule requires
before it will match a social identity to an existing user by email — without
it, many work accounts arrive with an unverified email and get refused at the
§3 linking rule. Pinning the tenant is the supported way to narrow that trust:
"the operator owns this directory" is a materially narrower trust statement
than blanket-trusting Microsoft's email claim, which SassyAuth deliberately
does not do (see the design doc, §6).

**Open item — unverified.** Which exact Entra optional-claim configuration
populates the fields BetterAuth reads is not yet confirmed against a real
tenant. If you find the working configuration, please contribute it back;
this guide intentionally does not describe portal steps for it, to avoid
sending you down a path nobody has verified.

## Apple

**Requires a paid Apple Developer Program membership (~$99/year).** There is
no free path for Sign in with Apple.

You will need:

- An **App ID** with the "Sign in with Apple" capability enabled.
- A **Services ID** — this is what you pass as `APPLE_CLIENT_ID`. It is *not*
  the App ID; Apple's OAuth `client_id` is the Services ID.
- A **Sign in with Apple key** (a `.p8` private key file). Apple lets you
  download this file **exactly once** — store it securely immediately, since
  there is no way to re-download it later (you would have to revoke the key
  and generate a new one).
- **Domain verification**: host Apple's
  `apple-developer-domain-association.txt` file on the domain you use as the
  return URL, following Apple's domain-verification process for the Services
  ID.

| Apple value             | Env var               |
|--------------------------|-------------------------|
| Services ID              | `APPLE_CLIENT_ID`       |
| Team ID                  | `APPLE_TEAM_ID`         |
| Key ID of the `.p8`      | `APPLE_KEY_ID`          |
| Contents of the `.p8`    | `APPLE_PRIVATE_KEY`     |

**There is no `APPLE_CLIENT_SECRET` environment variable.** Apple's
`client_secret` is not a static value — it is an ES256 JWT (`iss` = team ID,
`sub` = Services ID, `aud` = `https://appleid.apple.com`, signed with the
`.p8` key, `kid` header = key ID) that Apple rejects once it is older than six
months. A static secret would work at deploy time and then break silently,
months later, with no code change to blame. SassyAuth instead generates this
JWT at runtime from `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY`,
caches it, and regenerates it before it expires.

**Apple cannot be tested locally or in CI.** Apple rejects `localhost` return
URLs outright, and its callback uses `response_mode=form_post` rather than a
redirect with query parameters, so validating an Apple integration requires a
publicly reachable HTTPS deployment whose hostname is both the verified
return-URL domain and the value of `BETTER_AUTH_URL` — a tunnel (e.g. ngrok
pointed at a domain you've verified) or a real deployment. Apple sign-in is
therefore **manual-verification-only**: it is implemented and documented, but
not exercised by the automated test suite. See the README's
[Known Limitations](../README.md#known-limitations).

**"Hide My Email" is handled, not just a caveat.** Apple lets users relay
their real address through a private `@privaterelay.appleid.com` address.
SassyAuth detects this via Apple's own `is_private_email` claim (not by
pattern-matching the relay domain) and shows the user a specific message
telling them to choose "Share My Email" on Apple's consent screen instead —
this case works correctly and is not a limitation.

## Non-production only

| Env var             | Purpose                                                              |
|-----------------------|----------------------------------------------------------------------|
| `E2E_STUB_IDP_URL`     | URL of the stub OIDC provider used by the e2e suite. **Do not set this in production** — the stub, if reachable, is a complete authentication bypass. It only registers when `NODE_ENV` is exactly `test` or `development`; any other value (including an unset or misspelled `NODE_ENV`) keeps it disabled regardless of this variable. |

## Two other things worth knowing

- **An inactive (deactivated) `SaUser` sees a bare `403`, not the friendly
  `/oauth-error` page.** BetterAuth's session-creation gate refuses the sign-in
  before the hook that would redirect to a friendly error page can run,
  because the response status is already frozen by that point. The refusal is
  still fully audited (`SaAuditEvent`) even though the user-facing error is
  unfriendly. This is a known, accepted limitation, not a bug to chase.
- Social sign-in never bypasses or satisfies your app's own two-factor
  requirement. If an app has `requireTwoFactor` set, a federated user still
  has to enroll in and complete SassyAuth's own TOTP after signing in with
  Google/Microsoft/Apple. Provider-asserted MFA (e.g. Microsoft Entra's own
  `amr: ["mfa"]`) is not trusted, since Google does not reliably assert it and
  a control that only works for one provider is worse than no control.
