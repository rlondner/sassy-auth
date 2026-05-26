import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

@Controller('api/invitations')
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
