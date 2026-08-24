import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          {
            provide: AuthService,
            useValue: mockAuthService,
          },
        ],
      }).compile();

    controller =
      module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('should call AuthService.register with the DTO', async () => {
      const dto = {
        email: 'doctor@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        phone: '5551234567',
        specialty: 'Cardiology',
      };

      const expectedResult = {
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        doctorProfile: {
          id: 'doctor-123',
        },
      };

      mockAuthService.register.mockResolvedValue(
        expectedResult,
      );

      const result =
        await controller.register(dto);

      expect(
        mockAuthService.register,
      ).toHaveBeenCalledWith(dto);

      expect(result).toEqual(expectedResult);
    });
  });

  describe('login', () => {
    it('should call AuthService.login with the DTO', async () => {
      const dto = {
        email: 'doctor@test.com',
        password: 'password123',
      };

      const expectedResult = {
        accessToken: 'jwt-token-123',
      };

      mockAuthService.login.mockResolvedValue(
        expectedResult,
      );

      const result =
        await controller.login(dto);

      expect(
        mockAuthService.login,
      ).toHaveBeenCalledWith(dto);

      expect(result).toEqual(expectedResult);
    });
  });
});