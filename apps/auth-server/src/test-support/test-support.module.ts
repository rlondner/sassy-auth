import { Module } from '@nestjs/common';
import { OtpTestController } from './otp-test.controller';

@Module({ controllers: [OtpTestController] })
export class TestSupportModule {}
