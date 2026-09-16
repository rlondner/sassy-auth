export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Per-send override; falls back to EmailService's EMAIL_FROM default when absent. */
  from?: string;
}

export interface OutgoingEmail extends EmailMessage {
  from: string;
}

export interface EmailTransport {
  readonly name: string;
  send(msg: OutgoingEmail): Promise<void>;
}

export interface EmailMessageParts {
  subject: string;
  html: string;
  text: string;
}

/** DI token for the concrete transport chosen at startup. */
export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');
