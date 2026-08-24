import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';

import { Test, TestingModule } from '@nestjs/testing';

import { JwtService } from '@nestjs/jwt';

import * as argon2 from 'argon2';

import { AuthService } from './auth.service';

import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          AuthService,
          {
            provide: PrismaService,
            useValue: mockPrisma,
          },
          {
            provide: JwtService,
            useValue: mockJwtService,
          },
        ],
      }).compile();

    service =
      module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should register a new user and create a doctor profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      mockPrisma.user.create.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        passwordHash: 'hashed-password',

        doctorProfile: {
          id: 'doctor-123',
          firstName: 'John',
          lastName: 'Doe',
          phone: '5551234567',
          specialty: 'Cardiology',
        },
      });

      const dto = {
        email: 'doctor@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        phone: '5551234567',
        specialty: 'Cardiology',
      };

      const result =
        await service.register(dto);

      expect(
        mockPrisma.user.findUnique,
      ).toHaveBeenCalledWith({
        where: {
          email: dto.email,
        },
      });

      expect(
        mockPrisma.user.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: dto.email,

            doctorProfile: {
              create: {
                firstName: dto.firstName,
                lastName: dto.lastName,
                phone: dto.phone,
                specialty: dto.specialty,
              },
            },
          }),

          include: {
            doctorProfile: true,
          },
        }),
      );

      expect(result).toEqual({
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',

        doctorProfile: {
          id: 'doctor-123',
          firstName: 'John',
          lastName: 'Doe',
          phone: '5551234567',
          specialty: 'Cardiology',
        },
      });

      expect(result).not.toHaveProperty(
        'passwordHash',
      );
    });

    it('should hash the password before creating the user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      mockPrisma.user.create.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        passwordHash: 'hashed-password',
        doctorProfile: null,
      });

      const dto = {
        email: 'doctor@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        phone: '5551234567',
        specialty: 'Cardiology',
      };

      await service.register(dto);

      const createCall =
        mockPrisma.user.create.mock.calls[0][0];

      expect(
        createCall.data.passwordHash,
      ).not.toBe(dto.password);

      expect(
        await argon2.verify(
          createCall.data.passwordHash,
          dto.password,
        ),
      ).toBe(true);
    });

    it('should throw if the email is already registered', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: 'doctor@test.com',
      });

      const dto = {
        email: 'doctor@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        phone: '5551234567',
        specialty: 'Cardiology',
      };

      await expect(
        service.register(dto),
      ).rejects.toThrow(
        new ConflictException(
          'Email already registered',
        ),
      );

      expect(
        mockPrisma.user.create,
      ).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should login with valid credentials and return access and refresh tokens', async () => {
      const passwordHash =
        await argon2.hash('password123');

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        passwordHash,
        role: 'DOCTOR',
      });

      mockJwtService.signAsync
        .mockResolvedValueOnce(
          'access-token-123',
        )
        .mockResolvedValueOnce(
          'refresh-token-123',
        );

      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        refreshTokenHash:
          'hashed-refresh-token',
      });

      const dto = {
        email: 'doctor@test.com',
        password: 'password123',
      };

      const result =
        await service.login(dto);

      expect(
        mockPrisma.user.findUnique,
      ).toHaveBeenCalledWith({
        where: {
          email: dto.email,
        },
      });

      expect(
        mockJwtService.signAsync,
      ).toHaveBeenCalledTimes(2);

      const expectedPayload = {
        sub: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
      };

      // Access token
      expect(
        mockJwtService.signAsync,
      ).toHaveBeenNthCalledWith(
        1,
        expectedPayload,
      );

      // Refresh token
      expect(
        mockJwtService.signAsync,
      ).toHaveBeenNthCalledWith(
        2,
        expectedPayload,
        {
          expiresIn: '7d',
        },
      );

      expect(
        mockPrisma.user.update,
      ).toHaveBeenCalledWith({
        where: {
          id: 'user-123',
        },

        data: {
          refreshTokenHash:
            expect.any(String),
        },
      });

      const updateCall =
        mockPrisma.user.update.mock.calls[0][0];

      expect(
        updateCall.data.refreshTokenHash,
      ).not.toBe('refresh-token-123');

      expect(result).toEqual({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
      });
    });

    it('should hash the refresh token before storing it', async () => {
      const passwordHash =
        await argon2.hash('password123');

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        passwordHash,
        role: 'DOCTOR',
      });

      mockJwtService.signAsync
        .mockResolvedValueOnce(
          'access-token-123',
        )
        .mockResolvedValueOnce(
          'refresh-token-123',
        );

      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        refreshTokenHash:
          'hashed-refresh-token',
      });

      await service.login({
        email: 'doctor@test.com',
        password: 'password123',
      });

      const updateCall =
        mockPrisma.user.update.mock.calls[0][0];

      const storedHash =
        updateCall.data.refreshTokenHash;

      expect(storedHash).not.toBe(
        'refresh-token-123',
      );

      expect(
        await argon2.verify(
          storedHash,
          'refresh-token-123',
        ),
      ).toBe(true);
    });

    it('should throw if the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        null,
      );

      const dto = {
        email: 'unknown@test.com',
        password: 'password123',
      };

      await expect(
        service.login(dto),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Invalid credentials',
        ),
      );

      expect(
        mockJwtService.signAsync,
      ).not.toHaveBeenCalled();

      expect(
        mockPrisma.user.update,
      ).not.toHaveBeenCalled();
    });

    it('should throw if the password is incorrect', async () => {
      const passwordHash =
        await argon2.hash(
          'correct-password',
        );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        passwordHash,
        role: 'DOCTOR',
      });

      const dto = {
        email: 'doctor@test.com',
        password: 'wrong-password',
      };

      await expect(
        service.login(dto),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Invalid credentials',
        ),
      );

      expect(
        mockJwtService.signAsync,
      ).not.toHaveBeenCalled();

      expect(
        mockPrisma.user.update,
      ).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should return new access and refresh tokens', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
      });

      const storedHash =
        await argon2.hash(
          'refresh-token-123',
        );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        refreshTokenHash: storedHash,
      });

      mockJwtService.signAsync
        .mockResolvedValueOnce(
          'new-access-token',
        )
        .mockResolvedValueOnce(
          'new-refresh-token',
        );

      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        refreshTokenHash:
          'new-hash',
      });

      const result =
        await service.refresh(
          'refresh-token-123',
        );

      expect(
        mockJwtService.verifyAsync,
      ).toHaveBeenCalledWith(
        'refresh-token-123',
      );

      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      expect(
        mockPrisma.user.update,
      ).toHaveBeenCalledWith({
        where: {
          id: 'user-123',
        },

        data: {
          refreshTokenHash:
            expect.any(String),
        },
      });
    });

    it('should reject an invalid refresh token', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(
        new Error('Invalid token'),
      );

      await expect(
        service.refresh(
          'invalid-refresh-token',
        ),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Invalid refresh token',
        ),
      );

      expect(
        mockPrisma.user.findUnique,
      ).not.toHaveBeenCalled();

      expect(
        mockPrisma.user.update,
      ).not.toHaveBeenCalled();
    });

    it('should reject a refresh token that is not stored for the user', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        refreshTokenHash: null,
      });

      await expect(
        service.refresh(
          'refresh-token-123',
        ),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Invalid refresh token',
        ),
      );

      expect(
        mockPrisma.user.update,
      ).not.toHaveBeenCalled();
    });

    it('should reject a refresh token with an invalid hash', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
      });

      const differentTokenHash =
        await argon2.hash(
          'different-refresh-token',
        );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        refreshTokenHash:
          differentTokenHash,
      });

      await expect(
        service.refresh(
          'refresh-token-123',
        ),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Invalid refresh token',
        ),
      );

      expect(
        mockPrisma.user.update,
      ).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should remove the refresh token hash', async () => {
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        refreshTokenHash: null,
      });

      const result =
        await service.logout('user-123');

      expect(
        mockPrisma.user.update,
      ).toHaveBeenCalledWith({
        where: {
          id: 'user-123',
        },

        data: {
          refreshTokenHash: null,
        },
      });

      expect(result).toEqual({
        message: 'Logged out successfully',
      });
    });
  });
});