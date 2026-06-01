import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

const mockService = {
  validateToken: jest.fn(),
  acceptInvitation: jest.fn(),
};

describe('InvitationsController', () => {
  let controller: InvitationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvitationsController],
      providers: [{ provide: InvitationsService, useValue: mockService }],
    }).compile();
    controller = module.get(InvitationsController);
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('forwards token to InvitationsService.validateToken', async () => {
      mockService.validateToken.mockResolvedValue({ email: 'a@b.io', firstName: 'A', lastName: 'B' });
      const result = await controller.validate('tok-123');
      expect(mockService.validateToken).toHaveBeenCalledWith('tok-123');
      expect(result.email).toBe('a@b.io');
    });
  });

  describe('accept', () => {
    it('forwards token and password to InvitationsService.acceptInvitation', async () => {
      mockService.acceptInvitation.mockResolvedValue(undefined);
      await controller.accept('tok-123', { password: 'StrongP@ss1' });
      expect(mockService.acceptInvitation).toHaveBeenCalledWith('tok-123', 'StrongP@ss1');
    });
  });
});
