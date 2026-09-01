import { recordFederationEvent } from '../social/record-federation-event';

const CONFIGURED_SECRETS = [
  'super-secret-rsa-key',
  'super-secret-better-auth-secret',
  'super-secret-apple-key',
];

describe('secret redaction across telemetry attributes', () => {
  beforeEach(() => {
    process.env.RSA_PRIVATE_KEY = Buffer.from('super-secret-rsa-key').toString('base64');
    process.env.BETTER_AUTH_SECRET = 'super-secret-better-auth-secret';
    process.env.APPLE_PRIVATE_KEY = 'super-secret-apple-key';
  });

  it('never places a configured secret into a federation event span or log attribute', async () => {
    const emitted: unknown[] = [];
    await recordFederationEvent(
      {
        db: { saAuditEvent: { create: async () => undefined } },
        logger: { warn: () => undefined },
        emit: (_severity, attributes) => emitted.push(attributes),
      },
      {
        type: 'social.signin.ok',
        provider: 'google',
        email: 'alice@acme.com',
        providerSub: 'sub-123',
        saUserPublicId: 'UkLW',
        appPublicId: 'qp31',
      },
    );

    const serialized = JSON.stringify(emitted);
    for (const secret of CONFIGURED_SECRETS) {
      expect(serialized).not.toContain(secret);
    }
  });
});
