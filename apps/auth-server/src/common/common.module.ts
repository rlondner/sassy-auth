import { Global, Module } from '@nestjs/common';
import { SqidService } from './sqid/sqid.service';

@Global()
@Module({
  providers: [SqidService],
  exports: [SqidService],
})
export class CommonModule {}
