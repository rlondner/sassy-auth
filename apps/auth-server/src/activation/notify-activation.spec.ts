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

const saUser = { id: 1, publicId: 'usr_1', orgId: 5 };

function signedBody(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('notifyActivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    mockPrisma.saAuditEvent.create.mockResolvedValue(undefined);
  });

  it('does nothing when the app has no webhookUrl configured', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', webhookUrl: null, webhookSecret: null },
    });

    await notifyActivation(saUser);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockPrisma.saAuditEvent.create).not.toHaveBeenCalled();
  });

  it('POSTs a signed payload and logs success to SaAuditEvent', async () => {
    mockPrisma.saOrg.findUnique.mockResolvedValue({
      app: { publicId: 'app_1', webhookUrl: 'https://rp.example.com/hooks', webhookSecret: 'whsec_test' },
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
      app: { publicId: 'app_1', webhookUrl: 'https://rp.example.com/hooks', webhookSecret: 'whsec_test' },
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
      app: { publicId: 'app_1', webhookUrl: 'https://rp.example.com/hooks', webhookSecret: 'whsec_test' },
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
      app: { publicId: 'app_1', webhookUrl: 'https://rp.example.com/hooks', webhookSecret: 'whsec_test' },
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
      app: { publicId: 'app_1', webhookUrl: 'https://rp.example.com/hooks', webhookSecret: 'whsec_test' },
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    mockPrisma.saAuditEvent.create.mockRejectedValue(new Error('db down'));

    await expect(notifyActivation(saUser)).resolves.toBeUndefined();
  });

  it('never throws if the org/app lookup itself fails', async () => {
    mockPrisma.saOrg.findUnique.mockRejectedValue(new Error('db down'));

    await expect(notifyActivation(saUser)).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
