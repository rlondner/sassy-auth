import { Resend } from 'resend';
import type { EmailTransport, OutgoingEmail } from '../email.types';

export class ResendTransport implements EmailTransport {
  readonly name = 'resend';
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(msg: OutgoingEmail): Promise<void> {
    const { error } = await this.client.emails.send({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (error) throw new Error(`Resend error: ${error.message}`);
  }
}
