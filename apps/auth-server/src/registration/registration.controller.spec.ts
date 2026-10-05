import { RegistrationController } from './registration.controller';

describe('RegistrationController — code-first signup routes', () => {
  const service = {
    register: jest.fn(),
    getAppName: jest.fn(),
    startRegistration: jest.fn().mockResolvedValue({ ok: true }),
    verifyRegistrationCode: jest.fn().mockResolvedValue({ ok: true }),
    completeRegistration: jest.fn().mockResolvedValue({ ok: true, orgPublicId: 'sq_1' }),
  };
  const controller = new RegistrationController(service as never);
  const req = { ip: '127.0.0.1', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as never;

  it('start delegates to RegistrationService.startRegistration (no IP — it does not need one)', async () => {
    const dto = { email: 'a@x.com', appPublicId: 'sq_1', turnstileToken: 'tok' };
    await controller.start(dto as never, req);
    expect(service.startRegistration).toHaveBeenCalledWith(dto);
  });

  it('verifyCode delegates to RegistrationService.verifyRegistrationCode', async () => {
    const dto = { email: 'a@x.com', otp: '123456' };
    await controller.verifyCode(dto as never);
    expect(service.verifyRegistrationCode).toHaveBeenCalledWith(dto);
  });

  it('complete delegates to RegistrationService.completeRegistration with the resolved client IP', async () => {
    const dto = { email: 'a@x.com', otp: '123456', password: 'x', firstName: 'A', lastName: 'B', appPublicId: 'sq_1' };
    await controller.complete(dto as never, req);
    expect(service.completeRegistration).toHaveBeenCalledWith(dto, '127.0.0.1');
  });
});
