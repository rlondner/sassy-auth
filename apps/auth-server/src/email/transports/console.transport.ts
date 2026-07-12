import type { EmailTransport, OutgoingEmail } from '../email.types';

/** Default transport: logs the message; sends nothing. Keeps dev/CI hermetic. */
export class ConsoleTransport implements EmailTransport {
  readonly name = 'console';

  // eslint-disable-next-line no-console
  constructor(private readonly out: { info(msg: string): void } = { info: (m) => console.log(m) }) {}

  async send(msg: OutgoingEmail): Promise<void> {
    this.out.info(`[email:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`);
  }
}
