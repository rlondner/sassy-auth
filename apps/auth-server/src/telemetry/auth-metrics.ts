import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('sassy-auth.auth-server');

const signInCounter = meter.createCounter('auth.signin.count', {
  description: 'Password sign-in attempts by outcome',
});

const tokenIssueDuration = meter.createHistogram('auth.token.issue.duration', {
  description: 'Time to issue a JWT after credentials verify, in milliseconds',
  unit: 'ms',
});

export function recordSignInOutcome(outcome: 'ok' | 'invalid_credentials' | 'two_factor_required'): void {
  signInCounter.add(1, { method: 'password', outcome });
}

export function recordTokenIssueDuration(durationMs: number, outcome: 'ok' | 'error'): void {
  tokenIssueDuration.record(durationMs, { outcome });
}

const federationCounter = meter.createCounter('auth.social.federation.count', {
  description: 'Social federation events by provider, type and outcome',
});

export function recordFederationOutcome(event: { provider: string; type: string; outcome: string }): void {
  federationCounter.add(1, { provider: event.provider, event_type: event.type, outcome: event.outcome });
}
