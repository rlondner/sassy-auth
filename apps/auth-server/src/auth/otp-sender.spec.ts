import { sendSignInOtp } from './otp-sender';

function makeDeps(user: { status: string } | null) {
  const send = jest.fn().mockResolvedValue({ sent: true });
  const set = jest.fn();
  const info = jest.fn();
  const deps = {
    db: { saUser: { findFirst: jest.fn().mockResolvedValue(user) } },
    emailer: { send },
    store: { set },
    logger: { info },
    isTest: true,
  };
  return { deps, send, set, info };
}

describe('sendSignInOtp', () => {
  it('emails the code and logs sent for an active user', async () => {
    const { deps, send, set, info } = makeDeps({ status: 'active' });
    await sendSignInOtp(deps, { email: 'a@x.com', otp: '654321', type: 'sign-in' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@x.com', subject: expect.stringMatching(/code|sign.?in/i) }),
    );
    expect(send.mock.calls[0][0].text).toContain('654321');
    expect(set).toHaveBeenCalledWith('a@x.com', '654321'); // test-store write
    expect(info).toHaveBeenCalledWith('Sign-in code requested', expect.objectContaining({ outcome: 'sent' }));
  });

  it('skips delivery and logs skipped_inactive for a non-active user', async () => {
    const { deps, send, info } = makeDeps({ status: 'inactive' });
    await sendSignInOtp(deps, { email: 'a@x.com', otp: '654321', type: 'sign-in' });
    expect(send).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Sign-in code requested', expect.objectContaining({ outcome: 'skipped_inactive' }));
  });

  it('skips delivery and logs skipped_unknown when no SaUser exists', async () => {
    const { deps, send, info } = makeDeps(null);
    await sendSignInOtp(deps, { email: 'a@x.com', otp: '654321', type: 'sign-in' });
    expect(send).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Sign-in code requested', expect.objectContaining({ outcome: 'skipped_unknown' }));
  });

  it('never logs the OTP value', async () => {
    const { deps, info } = makeDeps({ status: 'active' });
    await sendSignInOtp(deps, { email: 'a@x.com', otp: '654321', type: 'sign-in' });
    for (const call of info.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('654321');
    }
  });
});
