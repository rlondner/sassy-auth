import { Module } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { AuthModule } from './auth/auth.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';
import { UsersModule } from './users/users.module';
import { InvitationsModule } from './invitations/invitations.module';
import { OrgsModule } from './orgs/orgs.module';
import { RolesModule } from './roles/roles.module';
import { AppsModule } from './apps/apps.module';
import { PermissionsModule } from './permissions/permissions.module';
import { MeModule } from './me/me.module';

@Module({
  imports: [SentryModule.forRoot(), CommonModule, AuthModule, TokenModule, UsersModule, InvitationsModule, OrgsModule, RolesModule, AppsModule, PermissionsModule, MeModule],
})
export class AppModule {}
