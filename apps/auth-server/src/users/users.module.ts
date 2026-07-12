import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommonModule } from '../common/common.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [CommonModule, EmailModule],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
