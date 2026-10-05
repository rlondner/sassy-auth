import { sendVerificationCode } from './verification-code-sender';

describe('sendVerificationCode', () => {
  it('creates an OTP for the email-verification type and emails it with the given branding', async () => {
    const createOtp = jest.fn().mockResolvedValue('654321');
    const send = jest.fn().mockResolvedValue({ sent: true });
    await sendVerificationCode(
      { createOtp, emailer: { send } },
      { email: 'jane@example.com', firstName: 'Jane', appName: 'Vibecast', branding: { fromName: 'Vibecast' } },
    );
    expect(createOtp).toHaveBeenCalledWith({ email: 'jane@example.com', type: 'email-verification' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        subject: 'Verify your Vibecast email address',
        from: 'Vibecast',
        html: expect.stringContaining('654321'),
      }),
    );
  });

  it('sends with no branding when none is given', async () => {
    const createOtp = jest.fn().mockResolvedValue('111111');
    const send = jest.fn().mockResolvedValue({ sent: true });
    await sendVerificationCode(
      { createOtp, emailer: { send } },
      { email: 'jane@example.com', firstName: 'Jane', appName: 'Sassy Auth' },
    );
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Verify your Sassy Auth email address', from: undefined }));
  });
});
