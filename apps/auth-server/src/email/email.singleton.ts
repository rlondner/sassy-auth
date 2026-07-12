import { EmailService } from './email.service';
import { selectTransport } from './select-transport';
import { LoggerService } from '../common/logger/logger.service';

let instance: EmailService | null = null;

/** EmailService for use outside Nest DI (e.g. the BetterAuth config module). */
export function getEmailer(): EmailService {
  if (!instance) {
    instance = new EmailService(selectTransport(process.env), new LoggerService());
  }
  return instance;
}
