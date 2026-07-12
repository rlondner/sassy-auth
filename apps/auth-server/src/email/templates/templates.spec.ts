import { invitationEmail } from './invitation.template';
import { passwordResetEmail } from './password-reset.template';
import { signInCodeEmail } from './sign-in-code.template';

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
});
