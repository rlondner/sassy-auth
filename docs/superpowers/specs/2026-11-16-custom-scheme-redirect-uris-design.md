# Custom-scheme redirect URIs — design

Date: 2026-11-16

## Problem

SaApp only accepts `http(s)` redirect URIs for both `login` and `post_logout`
registrations. A native/mobile client authenticating against SaApp can't
receive the OAuth authorization code back into the app unless it can
register a custom-scheme redirect URI (e.g. `com.vibecast.app://auth`) — the
browser/webview has no `https` endpoint inside the app to redirect to.

This is a general platform capability: any app registered with SaApp should
be able to use a custom-scheme redirect, not just a specific client.

## Policy

Any redirect URI whose scheme is not `http`/`https` is a "custom scheme"
redirect, and two rules apply to it:

1. **Reverse-domain scheme naming.** Per RFC 8252 §7.1, the scheme must be
   dot-separated with at least two labels, each starting with a letter (e.g.
   `com.vibecast.app`). A bare word like `vibecast` is rejected — a
   single-label scheme can be claimed by more than one app on a device,
   which would let a malicious app intercept the authorization code.
2. **PKCE is mandatory.** A custom-scheme redirect is always treated as a
   public-client redirect for PKCE purposes, regardless of whether the app
   has a client secret configured. A secret embedded in a distributed app
   binary can't be kept confidential, so the client-secret exemption from
   PKCE (`isConfidential`) must not apply when the redirect URI itself is a
   custom scheme.

These two rules are the entire change in authorization semantics. Everything
else in the request/response pipeline (DB storage, `new URL()` parsing, the
302 `Location` redirect, Nest's `@Redirect()`, Helmet's default CSP) already
tolerates arbitrary URI schemes — confirmed by reading the actual code paths
below, not assumed.

## Changes

### 1. Redirect URI scheme validation — `apps/auth-server/src/apps/apps.service.ts`

`assertValidRedirectUris` (currently ~line 74-100) hard-rejects any
non-http(s) protocol:

```ts
if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
  throw new BadRequestException(`Redirect URI must be http(s): ${r.uri}`);
}
```

Replace with a check that accepts `http:`/`https:` as today, OR a scheme
matching reverse-domain notation:

```ts
const CUSTOM_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+-]*(\.[a-zA-Z][a-zA-Z0-9+-]*)+$/;

const schemeName = parsed.protocol.slice(0, -1); // strip trailing ':'
const isHttpLike = parsed.protocol === 'http:' || parsed.protocol === 'https:';
const isCustomScheme = CUSTOM_SCHEME_RE.test(schemeName);
if (!isHttpLike && !isCustomScheme) {
  throw new BadRequestException(
    `Redirect URI scheme must be http(s) or reverse-domain (e.g. com.example.app): ${r.uri}`,
  );
}
```

The exact message text matters — it's matched on by the admin UI's error
mapping (see Change 4).

Applies identically to both `login` and `post_logout` kinds; no special-casing
by kind.

### 2. PKCE enforcement at `/authorize` — `apps/auth-server/src/token/token.controller.ts`

Add a shared helper next to the existing URI logic in
`apps/auth-server/src/token/redirect-uri.ts`:

```ts
export function isCustomSchemeRedirect(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol !== 'http:' && protocol !== 'https:';
  } catch {
    return false;
  }
}
```

In the authorize handler (currently ~line 172-183):

```ts
const isConfidential = app.clientSecretHash !== null;
const pkceRequired = !isConfidential || isCustomSchemeRedirect(redirectUri);
if (codeChallenge) {
  if (codeChallengeMethod !== 'S256') {
    throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
  }
} else if (pkceRequired) {
  throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
}
```

This runs before `assertRedirectUriAllowed`, same as today — an
unparseable `redirectUri` falls through to `isCustomSchemeRedirect` returning
`false` (so this check is a no-op) and gets rejected immediately after by
`assertRedirectUriAllowed` instead, preserving the existing error path for
malformed URIs.

### 3. PKCE enforcement in the signup-flow redirect — `apps/auth-server/src/registration/registration.service.ts`

The inline signup redirect (currently ~line 345-365) generates an
authorization code for a recovered or fallback redirect URI when
`codeChallenge || isConfidential`:

```ts
if (redirectUri && (codeChallenge || isConfidential)) { ... }
```

A confidential app whose recovered/fallback redirect URI is a custom scheme
must not get a free pass here — update to:

```ts
const pkceRequired = !isConfidential || (redirectUri && isCustomSchemeRedirect(redirectUri));
if (redirectUri && (codeChallenge || !pkceRequired)) { ... }
```

(Exact boolean wiring to be finalized against the surrounding code during
implementation — the intent is: a custom-scheme `redirectUri` must have a
`codeChallenge` to proceed, full stop, regardless of `isConfidential`.)

### 4. Admin UI error mapping — `apps/admin/app/(admin)/apps/actions.ts`

`mapError` currently collapses every unrecognized `400` from create/update
app into `apps.errors.urlInsecure` ("must use https and a public host") —
including the three independent `assertValidRedirectUris` failure cases
(invalid URI, invalid scheme, duplicate URI), which have nothing to do with
the `isAppUrlAllowed` https/public-host policy on the app's `url`/
`callbackUrl` fields. This existed before this change and produces a
misleading message for any redirect-URI validation failure, not just the
new scheme rule — worth fixing alongside it since the new rule will make
redirect-URI 400s more common (users will mistype the reverse-domain form).

Add a branch ahead of the generic `400` fallback, same pattern as the
existing `activationEmailOverride.` check:

```ts
if (message.includes('Redirect URI')) {
  return 'apps.errors.redirectUriInvalid'
}
```

New i18n string (`apps/admin/messages/en.json`, `fr.json`):

- `apps.errors.redirectUriInvalid`: "Please enter a valid redirect URI.
  Custom schemes must use reverse-domain notation, e.g.
  com.example.app://callback."

### 5. Admin UI copy — `apps/admin/components/redirect-uri-rows-editor.tsx` / messages

No code change needed in the editor component — `<input type="url">`
already accepts custom schemes under the WHATWG URL parser. Update the
`apps.fields.redirectUriPlaceholder` string (en/fr) to show a custom-scheme
example alongside the https one, so the reverse-domain requirement is
visible before a rejection, not just after.

## Testing

- `apps/auth-server/src/apps/apps.service.spec.ts`: update the existing
  "rejects a redirect URI that is not an absolute http(s) URL" test for the
  new message text; add cases for an accepted reverse-domain scheme
  (`com.vibecast.app://auth`) and a rejected bare-word scheme
  (`vibecast://auth`).
- `apps/auth-server/src/token/redirect-uri.spec.ts`: add a case exercising
  `isCustomSchemeRedirect` directly, and an exact-match case for a
  registered custom-scheme URI (confirms no change needed to
  `isExactMatch`).
- `apps/auth-server/src/token/token.controller.spec.ts`: add a case where a
  confidential app's `/authorize` request with a custom-scheme
  `redirect_uri` and no `code_challenge` is rejected (`INVALID_REQUEST`).
- `apps/auth-server/src/registration/registration.service.spec.ts`: same
  intent for the signup-flow redirect path.
- `apps/admin/app/(admin)/__tests__/resource-actions.test.ts`: add a case
  mapping an "API error 400: Redirect URI scheme must be..." message to
  `apps.errors.redirectUriInvalid`.
- No e2e changes planned — existing OIDC round-trip e2e tests use http(s)
  and are unaffected.

## Out of scope

- Enforcing or verifying that a registered custom scheme is actually
  claimed/owned by the registering app on-device (OS-level scheme
  ownership is outside SaApp's control; the reverse-domain naming rule
  mitigates but doesn't eliminate collision risk).
- Universal Links / App Links (https-based deep linking) as an alternative
  to custom schemes — not requested, and a materially different mechanism.
- Introducing a persisted "client type" (confidential/public) field on
  `SaApp` — confidentiality continues to be inferred from
  `clientSecretHash` presence, as today; only the PKCE-required computation
  changes (Changes 2 and 3).
