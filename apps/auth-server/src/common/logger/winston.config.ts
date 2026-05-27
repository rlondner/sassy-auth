import * as winston from 'winston';
import * as path from 'path';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const prettyFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, context, traceId, requestId, stack, ...meta }) => {
    const ctx = context ? ` [${context}]` : '';
    const ids = [traceId && `traceId=${traceId}`, requestId && `requestId=${requestId}`]
      .filter(Boolean)
      .join(' ');
    const suffix = ids ? ` | ${ids}` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] ${level.toUpperCase()}${ctx} ${message}${suffix}${metaStr}`;
    return stack ? `${line}\n${stack}` : line;
  }),
);

export function createAppLogger(): winston.Logger {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: isProduction ? jsonFormat : prettyFormat,
    }),
  ];

  // Dev-only file transports
  if (!isProduction) {
    const logsDir = path.resolve(process.cwd(), 'logs');
    transports.push(
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        format: jsonFormat,
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        format: jsonFormat,
      }),
    );
  }

  return winston.createLogger({
    level: logLevel,
    defaultMeta: {},
    transports,
  });
}
