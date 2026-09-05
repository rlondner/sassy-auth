import { Controller, Get, Query } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { PasswordPolicy } from '@sassy-auth/types';
import { getGlobalPasswordPolicy, resolvePasswordPolicy } from './password-policy';
import { resolveAppForResetToken } from './resolve-app-for-reset-token';

/**
 * Public (no auth guard), unauthenticated by design — the forgot-password
 * page needs the effective policy for its live requirements checklist
 * before the user has proven they control the account. Returns the GLOBAL
 * policy (never a 404/error) for a missing or unresolvable resetToken: the
 * page still needs something to render, and the hooks.before matcher in
 * auth.config.ts is the actual enforcement at submit time regardless of
 * what this endpoint showed beforehand.
 */
@Controller('password-policy')
export class PasswordPolicyController {
  @Get()
  async get(@Query('resetToken') resetToken?: string): Promise<{ passwordPolicy: PasswordPolicy }> {
    if (!resetToken) {
      return { passwordPolicy: getGlobalPasswordPolicy(process.env) };
    }
    const app = await resolveAppForResetToken(prisma, resetToken);
    return { passwordPolicy: resolvePasswordPolicy(app ?? { passwordPolicyOverride: null }) };
  }
}
