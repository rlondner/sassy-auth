import type { EmailTransport } from './email.types';
import { ConsoleTransport } from './transports/console.transport';
import { SmtpTransport } from './transports/smtp.transport';
import { ResendTransport } from './transports/resend.transport';

/** Choose the transport once, by env priority: Resend > SMTP > Console. */
export function selectTransport(env: NodeJS.ProcessEnv): EmailTransport {
  if (env.RESEND_API_KEY) return new ResendTransport(env.RESEND_API_KEY);
  if (env.EMAIL_SMTP_HOST) {
    return new SmtpTransport({
      host: env.EMAIL_SMTP_HOST,
      port: Number(env.EMAIL_SMTP_PORT ?? '587'),
      secure: env.EMAIL_SMTP_SECURE === 'true',
      user: env.EMAIL_SMTP_USER,
      pass: env.EMAIL_SMTP_PASS,
    });
  }
  return new ConsoleTransport();
}
