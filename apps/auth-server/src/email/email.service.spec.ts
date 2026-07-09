import { Test } from '@nestjs/testing';
import { EmailService } from './email.service';
import { EMAIL_TRANSPORT, type EmailTransport } from './email.types';
import { LoggerService } from '../common/logger/logger.service';

function makeLogger() {
  const warn = jest.fn();
  return {
    provider: { provide: LoggerService, useValue: { getWinstonLogger: () => ({ warn, info: jest.fn() }) } },
    warn,
  };
}

describe('EmailService', () => {
  afterEach(() => { delete process.env.EMAIL_FROM });

  async function build(transport: EmailTransport) {
    const logger = makeLogger();
    const moduleRef = await Test.createTestingModule({
      providers: [EmailService, logger.provider, { provide: EMAIL_TRANSPORT, useValue: transport }],
    }).compile();
    return { service: moduleRef.get(EmailService), warn: logger.warn };
  }

  it('sends via the transport with the configured from and returns { sent: true }', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    process.env.EMAIL_FROM = 'sender@x.co';
    const { service } = await build({ name: 'fake', send });
    const res = await service.send({ to: 'a@b.co', subject: 'S', html: '<p>h</p>', text: 'h' });
    expect(res).toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'sender@x.co', to: 'a@b.co', subject: 'S' }));
  });

  it('never throws when the transport fails — returns { sent: false } and warns', async () => {
    const send = jest.fn().mockRejectedValue(new Error('smtp down'));
    const { service, warn } = await build({ name: 'fake', send });
    const res = await service.send({ to: 'a@b.co', subject: 'S', html: '<p>h</p>', text: 'h' });
    expect(res).toEqual({ sent: false });
    expect(warn).toHaveBeenCalled();
  });
});
