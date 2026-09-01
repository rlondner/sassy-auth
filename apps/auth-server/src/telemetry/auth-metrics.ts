import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('sassy-auth.auth-server');

const signInCounter = meter.createCounter('auth.signin.count', {
  description: 'Password sign-in attempts by outcome',
});

const tokenIssueDuration = meter.createHistogram('auth.token.issue.duration', {
  description: 'Time to issue a JWT after credentials verify, in milliseconds',
  unit: 'ms',
});

// OTel's API contract says counter/histogram calls shouldn't throw, but per
// the "telemetry failures must never break the app" constraint we guard
// defensively anyway. These are low-level metric calls (unlike the
// higher-level audit path in record-federation-event.ts, which already has
// its own logger), so failures are swallowed silently with no logging.
function guard(fn: () => void): void {
  try {
    fn();
  } catch {
    // swallow — telemetry must never break the app
  }
}

export function recordSignInOutcome(outcome: 'ok' | 'invalid_credentials' | 'two_factor_required'): void {
  guard(() => signInCounter.add(1, { method: 'password', outcome }));
}

export function recordTokenIssueDuration(durationMs: number, outcome: 'ok' | 'error'): void {
  guard(() => tokenIssueDuration.record(durationMs, { outcome }));
}

const federationCounter = meter.createCounter('auth.social.federation.count', {
  description: 'Social federation events by provider, type and outcome',
});

export function recordFederationOutcome(event: { provider: string; type: string; outcome: string }): void {
  guard(() =>
    federationCounter.add(1, { provider: event.provider, event_type: event.type, outcome: event.outcome }),
  );
}

const twoFactorCounter = meter.createCounter('auth.2fa.challenge.count', {
  description: '2FA challenge outcomes on the direct-login path',
});

const registrationRateLimitCounter = meter.createCounter('auth.register.rate_limited', {
  description: 'Self-serve registration requests rejected by the rate limiter',
});

export function record2faChallengeOutcome(
  outcome: 'ok' | 'missing_or_invalid_code' | 'required_not_enrolled',
): void {
  guard(() => twoFactorCounter.add(1, { outcome }));
}

export function recordRegistrationRateLimited(): void {
  guard(() => registrationRateLimitCounter.add(1));
}
