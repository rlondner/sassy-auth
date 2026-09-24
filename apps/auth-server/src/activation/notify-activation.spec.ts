import * as crypto from 'crypto';
import { notifyActivation } from './notify-activation';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saOrg: { findUnique: jest.fn() },
    saAuditEvent: { create: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockPrisma = require('@sassy-auth/db').prisma as {
  saOrg: { findUnique: jest.Mock };
  saAuditEvent: { create: jest.Mock };
};

const saUser = {
  id: 1,
  publicId: 'usr_1',
  orgId: 5,
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
};

function signedBody(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('notifyActivation', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    mockPrisma.saAuditEvent.create.mockResolvedValue(undefined);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('does nothing when the app has no activationWebhookUrl configured', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: null, activationWebhookSecret: null },
    });
    const emit = jest.fn();

    await notifyActivation(saUser, { emit });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPrisma.saAuditEvent.create).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('emits a redacted OTel log and a full-detail console.log before calling the webhook', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: 'https://rp.example.com/hooks', activationWebhookSecret: 'whsec_test' },
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    const emit = jest.fn();

    await notifyActivation(saUser, { emit });

    expect(emit).toHaveBeenCalledWith({
      'activation.event': 'webhook.called',
      'app.public_id': 'app_1',
      'user.public_id': 'usr_1',
      'user.first_name': 'J***',
      'user.last_name': 'D***',
      'user.email': 'j***@example.com',
    });
    // The OTel emission is the only PII-adjacent channel checked for
    // redaction above — assert directly that the real name/email never
    // appear in any argument passed to it.
    const emittedValues = Object.values(emit.mock.calls[0][0]);
    expect(emittedValues).not.toContain('Jane');
    expect(emittedValues).not.toContain('Doe');
    expect(emittedValues).not.toContain('jane.doe@example.com');

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Jane Doe <jane.doe@example.com>'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('app_1'));
  });

  it('emits the call log even when the webhook delivery itself later fails', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: 'https://rp.example.com/hooks', activationWebhookSecret: 'whsec_test' },
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    const emit = jest.fn();

    await notifyActivation(saUser, { emit });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  });

  it('never throws if the injected emit callback itself throws', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: 'https://rp.example.com/hooks', activationWebhookSecret: 'whsec_test' },
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    const emit = jest.fn(() => {
      throw new Error('collector unreachable');
    });

    await expect(notifyActivation(saUser, { emit })).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('POSTs a signed payload and logs success to SaAuditEvent', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: 'https://rp.example.com/hooks', activationWebhookSecret: 'whsec_test' },
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    await notifyActivation(saUser);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://rp.example.com/hooks');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body).toEqual({
      event: 'account.activated',
      userId: 'usr_1',
      appPublicId: 'app_1',
      activatedAt: expect.any(String),
      timestamp: expect.any(Number),
      nonce: expect.any(String),
    });
    expect(options.headers['X-Sassy-Signature']).toBe(`sha256=${signedBody('whsec_test', options.body)}`);

    expect(mockPrisma.saAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'activation_webhook_sent',
        saUserId: 1,
        appPublicId: 'app_1',
        reason: null,
      }),
    });
  });

  it('retries once on a network error, then logs failure', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: 'https://rp.example.com/hooks', activationWebhookSecret: 'whsec_test' },
    });
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    await notifyActivation(saUser);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockPrisma.saAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'activation_webhook_failed',
        saUserId: 1,
        appPublicId: 'app_1',
        reason: 'ECONNREFUSED',
      }),
    });
  });

  it('retries once on a 5xx response, then logs failure', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: 'https://rp.example.com/hooks', activationWebhookSecret: 'whsec_test' },
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });

    await notifyActivation(saUser);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockPrisma.saAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'activation_webhook_failed', reason: 'HTTP 503' }),
    });
  });

  it('does not retry a 4xx response', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: 'https://rp.example.com/hooks', activationWebhookSecret: 'whsec_test' },
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });

    await notifyActivation(saUser);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockPrisma.saAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'activation_webhook_failed', reason: 'HTTP 404' }),
    });
  });

  it('never throws even if the audit log write itself fails', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: 'https://rp.example.com/hooks', activationWebhookSecret: 'whsec_test' },
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    mockPrisma.saAuditEvent.create.mockRejectedValue(new Error('db down'));

    await expect(notifyActivation(saUser)).resolves.toBeUndefined();
  });

  it('logs activation_webhook_failed and never throws when fetch rejects on a redirect (redirect: "error")', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', activationWebhookUrl: 'https://rp.example.com/hooks', activationWebhookSecret: 'whsec_test' },
    });
    // Simulates the fetch spec's behavior for `redirect: 'error'`: rather
    // than returning a response, fetch rejects when the server answers with
    // a redirect.
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('unexpected redirect'));

    await expect(notifyActivation(saUser)).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.redirect).toBe('error');
    expect(mockPrisma.saAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'activation_webhook_failed',
        reason: 'unexpected redirect',
      }),
    });
  });

  it('never throws if the org/app lookup itself fails', async () => {
    mockPrisma.saOrg.findUnique.mockRejectedValue(new Error('db down'));

    await expect(notifyActivation(saUser)).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
