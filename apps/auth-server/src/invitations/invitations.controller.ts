import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InvitationsService } from './invitations.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

// bug-0080: the invitation validate + accept endpoints are unauthenticated
// and the token is guessable-length (32 hex chars — 128 bits, so a random
// guess is astronomical, but the ATTACKER'S rate matters for defense-in-
// depth). Attach the `auth` throttler bucket (10 req/min/IP in prod) so a
// distributed guess is bounded per-source.
@Throttle({ auth: { limit: 10, ttl: 60_000 } })
@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Get(':token')
  validate(@Param('token') token: string) {
    return this.service.validateToken(token);
  }

  @Post(':token/accept')
  @HttpCode(204)
  accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    return this.service.acceptInvitation(token, dto.password);
  }
}
