import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { RateLimitGuard } from './rate-limit.guard';

describe('RegistrationController', () => {
  let controller: RegistrationController;
  const mockService = {
    register: jest.fn(),
    getAppName: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [RegistrationController],
      providers: [{ provide: RegistrationService, useValue: mockService }],
    }).compile();
    controller = module.get(RegistrationController);
  });

  describe('getAppName', () => {
    it('delegates to the service with the query param', async () => {
      mockService.getAppName.mockResolvedValue({ name: 'MyApp' });

      const result = await controller.getAppName('sq_1');

      expect(mockService.getAppName).toHaveBeenCalledWith('sq_1');
      expect(result).toEqual({ name: 'MyApp' });
    });

    // bug-0279: this route responds 200/404 distinguishably (unlike its
    // documented sibling GET /api/social-providers), making it an
    // enumeration oracle for appPublicId. It must carry the same
    // RateLimitGuard as POST /api/register so it can't be swept at will.
    it('carries RateLimitGuard, same as POST /api/register', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, RegistrationController.prototype.getAppName);
      expect(guards).toContain(RateLimitGuard);
    });
  });
});
