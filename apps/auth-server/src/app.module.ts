import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [CommonModule, AuthModule, TokenModule],
})
export class AppModule {}
