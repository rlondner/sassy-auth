import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { otpTestStore } from '../auth/otp-test-store';

/**
 * TEST-ONLY. Returns the last OTP issued to an email so the e2e suite can
 * complete a real passwordless sign-in. Every handler hard-fails with 404
 * unless NODE_ENV === 'test', and the module is only registered in test env
 * (Task 4 app.module wiring) — belt and suspenders so it can never exist in
 * production.
 */
@Controller('test')
export class OtpTestController {
  @Get('last-otp')
  lastOtp(@Query('email') email: string): { otp: string } {
    if (process.env.NODE_ENV !== 'test') throw new NotFoundException();
    const otp = email ? otpTestStore.get(email) : undefined;
    if (!otp) throw new NotFoundException();
    return { otp };
  }
}
