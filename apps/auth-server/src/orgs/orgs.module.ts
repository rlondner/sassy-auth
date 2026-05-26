import { Module } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { OrgsController } from './orgs.controller';

@Module({ providers: [OrgsService], controllers: [OrgsController] })
export class OrgsModule {}
