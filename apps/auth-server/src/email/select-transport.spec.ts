import { selectTransport } from './select-transport';

describe('selectTransport', () => {
  it('chooses resend when RESEND_API_KEY is set', () => {
    expect(selectTransport({ RESEND_API_KEY: 're_x', EMAIL_SMTP_HOST: 'h' } as NodeJS.ProcessEnv).name).toBe('resend');
  });
  it('chooses smtp when only EMAIL_SMTP_HOST is set', () => {
    expect(selectTransport({ EMAIL_SMTP_HOST: 'localhost', EMAIL_SMTP_PORT: '1025' } as NodeJS.ProcessEnv).name).toBe('smtp');
  });
  it('falls back to console when neither is set', () => {
    expect(selectTransport({} as NodeJS.ProcessEnv).name).toBe('console');
  });
});
