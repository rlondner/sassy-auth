import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

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
