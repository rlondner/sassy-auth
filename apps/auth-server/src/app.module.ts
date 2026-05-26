import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';
import { UsersModule } from './users/users.module';
import { InvitationsModule } from './invitations/invitations.module';

@Module({
  imports: [CommonModule, AuthModule, TokenModule, UsersModule, InvitationsModule],
})
export class AppModule {}
