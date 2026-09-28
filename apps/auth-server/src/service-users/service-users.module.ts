import { Module } from '@nestjs/common';
import { ServiceUsersController } from './service-users.controller';
import { ServiceUsersService } from './service-users.service';
import { ServiceTokenGuard } from './service-token.guard';
import { CommonModule } from '../common/common.module';
import { TokenModule } from '../token/token.module';

@Module({
  imports: [CommonModule, TokenModule],
  controllers: [ServiceUsersController],
  providers: [ServiceUsersService, ServiceTokenGuard],
})
export class ServiceUsersModule {}
