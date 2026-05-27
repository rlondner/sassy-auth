import { LoggerService } from './logger.service';

// Capture Winston transport output
let logOutput: any[] = [];

jest.mock('./winston.config', () => {
  const { transports, createLogger, format } = jest.requireActual('winston');
  const transport = new transports.Console({ silent: true });
  const original = (transport as any)._write.bind(transport);
  (transport as any)._write = (info: any, enc: string, callback: () => void) => {
    logOutput.push(info);
    original(info, enc, callback);
  };
  return {
    createAppLogger: () =>
      createLogger({
        level: 'debug',
        format: format.combine(format.timestamp(), format.json()),
        transports: [transport],
      }),
  };
});

describe('LoggerService', () => {
  let logger: LoggerService;

  beforeEach(() => {
    logOutput = [];
    logger = new LoggerService();
  });

  it('logs info messages with context', () => {
    logger.log('hello world', 'TestContext');
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0]).toMatchObject({
      level: 'info',
      message: 'hello world',
      context: 'TestContext',
    });
  });

  it('logs error messages with stack trace', () => {
    logger.error('something broke', 'stack-trace-here', 'TestContext');
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0]).toMatchObject({
      level: 'error',
      message: 'something broke',
      stack: 'stack-trace-here',
      context: 'TestContext',
    });
  });

  it('logs warn messages', () => {
    logger.warn('watch out', 'TestContext');
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0].level).toBe('warn');
  });

  it('logs debug messages', () => {
    logger.debug('detailed info', 'TestContext');
    expect(logOutput).toHaveLength(1);
    expect(logOutput[0].level).toBe('debug');
  });
});
