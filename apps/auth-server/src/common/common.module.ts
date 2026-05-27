import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { SqidService } from './sqid/sqid.service';
import { LoggerService } from './logger/logger.service';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { RequestLoggingMiddleware } from './logger/request-logging.middleware';

@Global()
@Module({
  providers: [SqidService, LoggerService],
  exports: [SqidService, LoggerService],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware, RequestLoggingMiddleware)
      .forRoutes('*');
  }
}
