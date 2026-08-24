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
    },
  };

  const mockJwtService = {
    signAsync: jest.fn(),
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

      const result = await service.register(dto);

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

      expect(createCall.data.passwordHash).not.toBe(
        dto.password,
      );

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
    it('should login with valid credentials and return an access token', async () => {
      const passwordHash =
        await argon2.hash('password123');

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        passwordHash,
        role: 'DOCTOR',
      });

      mockJwtService.signAsync.mockResolvedValue(
        'jwt-token-123',
      );

      const dto = {
        email: 'doctor@test.com',
        password: 'password123',
      };

      const result = await service.login(dto);

      expect(
        mockPrisma.user.findUnique,
      ).toHaveBeenCalledWith({
        where: {
          email: dto.email,
        },
      });

      expect(
        mockJwtService.signAsync,
      ).toHaveBeenCalledWith({
        sub: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
      });

      expect(result).toEqual({
        accessToken: 'jwt-token-123',
      });
    });

    it('should throw if the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

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
    });

    it('should throw if the password is incorrect', async () => {
      const passwordHash =
        await argon2.hash('correct-password');

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
    });
  });
});