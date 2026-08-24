import {
  Test,
  TestingModule,
} from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
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
      module.get<AuthController>(
        AuthController,
      );
  });

  // =========================
  // REGISTER
  // =========================

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

      expect(result).toEqual(
        expectedResult,
      );
    });
  });

  // =========================
  // LOGIN
  // =========================

  describe('login', () => {
    it('should call AuthService.login with the DTO', async () => {
      const dto = {
        email: 'doctor@test.com',
        password: 'password123',
      };

      const expectedResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      mockAuthService.login.mockResolvedValue(
        expectedResult,
      );

      const result =
        await controller.login(dto);

      expect(
        mockAuthService.login,
      ).toHaveBeenCalledWith(dto);

      expect(result).toEqual(
        expectedResult,
      );
    });
  });

  // =========================
  // REFRESH
  // =========================

  describe('refresh', () => {
    it('should call AuthService.refresh with the refresh token', async () => {
      const expectedResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mockAuthService.refresh.mockResolvedValue(
        expectedResult,
      );

      const result =
        await controller.refresh(
          'refresh-token-123',
        );

      expect(
        mockAuthService.refresh,
      ).toHaveBeenCalledWith(
        'refresh-token-123',
      );

      expect(result).toEqual(
        expectedResult,
      );
    });
  });

  // =========================
  // LOGOUT
  // =========================

  describe('logout', () => {
    it('should call AuthService.logout with the authenticated user id', async () => {
      const req = {
        user: {
          userId: 'user-123',
          email: 'doctor@test.com',
          role: 'DOCTOR',
        },
      } as any;

      const expectedResult = {
        message: 'Logged out successfully',
      };

      mockAuthService.logout.mockResolvedValue(
        expectedResult,
      );

      const result =
        await controller.logout(req);

      expect(
        mockAuthService.logout,
      ).toHaveBeenCalledWith(
        'user-123',
      );

      expect(result).toEqual(
        expectedResult,
      );
    });
  });
});