import { invitationEmail } from './invitation.template';
import { passwordResetEmail } from './password-reset.template';
import { signInCodeEmail } from './sign-in-code.template';
import { verificationEmail } from './verify-email.template';

describe('email templates', () => {
  it('invitationEmail embeds the invite URL and name in html + text', () => {
    const out = invitationEmail({ firstName: 'Jane', inviteUrl: 'https://x/accept-invite?token=abc' });
    expect(out.subject).toMatch(/invit/i);
    expect(out.html).toContain('https://x/accept-invite?token=abc');
    expect(out.text).toContain('https://x/accept-invite?token=abc');
    expect(out.text).toContain('Jane');
  });

  it('passwordResetEmail embeds the reset URL and name in html + text', () => {
    const out = passwordResetEmail({ firstName: 'Jane', resetUrl: 'https://x/reset-password?token=abc' });
    expect(out.subject).toMatch(/reset/i);
    expect(out.html).toContain('https://x/reset-password?token=abc');
    expect(out.text).toContain('https://x/reset-password?token=abc');
    expect(out.text).toContain('Jane');
    expect(out.html).toContain('Jane');
  });

  it('signInCodeEmail includes the code and expiry minutes in subject/text/html', () => {
    const parts = signInCodeEmail({ otp: '123456', minutes: 5 });
    expect(parts.subject).toMatch(/code|sign.?in/i);
    expect(parts.text).toContain('123456');
    expect(parts.html).toContain('123456');
    expect(parts.text).toContain('5');
    expect(parts.html).toContain('5');
  });

  it('verificationEmail uses the default subject/message and embeds appName, URL, name, and a button when no branding is given', () => {
    const out = verificationEmail({ firstName: 'Jane', verifyUrl: 'https://x/verify-email?token=abc', appName: 'Vibecast' });
    expect(out.subject).toBe('Verify your Vibecast email address');
    expect(out.html).toContain('https://x/verify-email?token=abc');
    expect(out.html).toContain('Confirm your email address to finish setting up your account:');
    expect(out.html).toContain('<table'); // the system-rendered button
    expect(out.text).toContain('https://x/verify-email?token=abc');
    expect(out.text).toContain('Jane');
    expect(out.from).toBeUndefined();
  });

  it('verificationEmail renders a custom subject/message with placeholders', () => {
    const out = verificationEmail({
      firstName: 'Jane',
      verifyUrl: 'https://x/verify-email?token=abc',
      appName: 'Vibecast',
      branding: { subject: 'Confirm your {{appName}} account, {{firstName}}!', message: 'Welcome to {{appName}}! Click below to confirm {{firstName}}.' },
    });
    expect(out.subject).toBe('Confirm your Vibecast account, Jane!');
    expect(out.html).toContain('Welcome to Vibecast! Click below to confirm Jane.');
    expect(out.text).toContain('Welcome to Vibecast! Click below to confirm Jane.');
  });

  it('verificationEmail computes from from fromName + fromAddress', () => {
    const out = verificationEmail({
      firstName: 'Jane', verifyUrl: 'https://x/verify', appName: 'Vibecast',
      branding: { fromName: 'Vibecast', fromAddress: 'no-reply@vibecast.io' },
    });
    expect(out.from).toBe('Vibecast <no-reply@vibecast.io>');
  });

  it('verificationEmail computes from from fromAddress alone', () => {
    const out = verificationEmail({
      firstName: 'Jane', verifyUrl: 'https://x/verify', appName: 'Vibecast',
      branding: { fromAddress: 'no-reply@vibecast.io' },
    });
    expect(out.from).toBe('no-reply@vibecast.io');
  });

  it('verificationEmail computes from from fromName alone', () => {
    const out = verificationEmail({
      firstName: 'Jane', verifyUrl: 'https://x/verify', appName: 'Vibecast',
      branding: { fromName: 'Vibecast' },
    });
    expect(out.from).toBe('Vibecast');
  });
});
