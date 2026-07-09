import * as nodemailer from 'nodemailer';
import type { EmailTransport, OutgoingEmail } from '../email.types';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

export class SmtpTransport implements EmailTransport {
  readonly name = 'smtp';
  private readonly transporter: nodemailer.Transporter;

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.pass ?? '' } } : {}),
    });
  }

  async send(msg: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  }
}
