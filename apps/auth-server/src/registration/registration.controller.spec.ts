import { Test } from '@nestjs/testing';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';

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
  });
});
