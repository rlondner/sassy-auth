import { NotFoundException } from '@nestjs/common';
import { OtpTestController } from './otp-test.controller';
import { otpTestStore } from '../auth/otp-test-store';

describe('OtpTestController', () => {
  const controller = new OtpTestController();
  const OLD_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
  });

  it('returns the stored otp in test env', () => {
    process.env.NODE_ENV = 'test';
    otpTestStore.set('u@x.com', '111222');
    expect(controller.lastOtp('u@x.com')).toEqual({ otp: '111222' });
  });

  it('404s when the email has no stored otp', () => {
    process.env.NODE_ENV = 'test';
    expect(() => controller.lastOtp('nobody@x.com')).toThrow(NotFoundException);
  });

  it('404s in non-test env even if a code is stored', () => {
    process.env.NODE_ENV = 'production';
    otpTestStore.set('u@x.com', '111222');
    expect(() => controller.lastOtp('u@x.com')).toThrow(NotFoundException);
  });
});
