import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { EmailService } from './email.service';
import { EMAIL_TRANSPORT } from './email.types';
import { selectTransport } from './select-transport';

@Module({
  imports: [CommonModule],
  providers: [
    EmailService,
    { provide: EMAIL_TRANSPORT, useFactory: () => selectTransport(process.env) },
  ],
  exports: [EmailService],
})
export class EmailModule {}
