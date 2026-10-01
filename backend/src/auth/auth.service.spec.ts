import {
  BadRequestException,
  Logger,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { PASSWORD_RESET_DELIVERY } from './password-reset-delivery';

import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    passwordResetToken: {
      findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };
  const delivery = { sendPasswordReset: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.passwordResetToken.findUnique.mockReset();
    mockPrisma.passwordResetToken.upsert.mockReset();
    mockPrisma.passwordResetToken.updateMany.mockReset().mockResolvedValue({ count: 1 });
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
    delivery.sendPasswordReset.mockReset().mockResolvedValue(undefined);
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PASSWORD_RESET_DELIVERY, useValue: delivery },
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

    service = module.get<AuthService>(AuthService);
  });

  describe('password reset', () => {
    const publicResponse = {
      message: 'If an account exists for that email, password reset instructions will be sent',
    };
    const rawToken = 'unit-test-reset-token';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const now = new Date('2026-09-30T18:00:00Z');
    const validToken = () => ({
      id: 'reset-123', userId: 'user-123', tokenHash,
      expiresAt: new Date(now.getTime() + 1800000), usedAt: null,
    });
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(now);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123' });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-123' });
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(validToken());
    });
    afterEach(() => jest.useRealTimers());

    it('stores only SHA-256 and delivers a random token with a 30 minute expiry', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      expect(await service.forgotPassword('Doctor@Test.com')).toEqual(publicResponse);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'Doctor@Test.com' } });
      expect(delivery.sendPasswordReset).toHaveBeenCalledTimes(1);
      const sent = delivery.sendPasswordReset.mock.calls[0][0];
      expect(sent.email).toBe('Doctor@Test.com');
      expect(Buffer.from(sent.token, 'base64url')).toHaveLength(32);
      expect(sent.expiresAt).toEqual(new Date(now.getTime() + 1800000));
      const hash = createHash('sha256').update(sent.token).digest('hex');
      expect(hash).not.toBe(sent.token);
      expect(mockPrisma.passwordResetToken.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        create: { userId: 'user-123', tokenHash: hash, expiresAt: sent.expiresAt, usedAt: null },
        update: { tokenHash: hash, expiresAt: sent.expiresAt, usedAt: null },
      });
    });

    it('returns the same response for an unknown email without storing or delivering', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.forgotPassword('missing@test.com')).toEqual(publicResponse);
      expect(mockPrisma.passwordResetToken.upsert).not.toHaveBeenCalled();
      expect(delivery.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('replaces the previous hash, expiry and usedAt on another request', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await service.forgotPassword('doctor@test.com');
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(mockPrisma.passwordResetToken.upsert.mock.calls[0][0].create);
      jest.setSystemTime(new Date(now.getTime() + 61000));
      await service.forgotPassword('doctor@test.com');
      const [first, second] = mockPrisma.passwordResetToken.upsert.mock.calls.map(call => call[0]);
      expect(second.where).toEqual(first.where);
      expect(second.update.tokenHash).not.toBe(first.update.tokenHash);
      expect(second.update.expiresAt).toEqual(new Date(now.getTime() + 1861000));
      expect(second.update.usedAt).toBeNull();
    });

    it('claims a valid token and stores an Argon2 password while invalidating refresh', async () => {
      expect(await service.resetPassword(rawToken, 'NewPassword123!')).toEqual({ message: 'Password reset successfully' });
      expect(mockPrisma.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash } });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'reset-123', tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      const update = mockPrisma.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'user-123' });
      expect(update.data.refreshTokenHash).toBeNull();
      expect(update.data.passwordHash).not.toBe('NewPassword123!');
      expect(await argon2.verify(update.data.passwordHash, 'NewPassword123!')).toBe(true);
    });

    it.each(['missing', 'expired', 'expires exactly now', 'used', 'claim lost'])(
      'rejects %s with the same error and no user update', async (scenario) => {
        const reset = validToken();
        mockPrisma.passwordResetToken.findUnique.mockResolvedValue(
          scenario === 'missing' ? null : {
            ...reset,
            expiresAt: scenario === 'expired' ? new Date(now.getTime() - 1)
              : scenario === 'expires exactly now' ? now : reset.expiresAt,
            usedAt: scenario === 'used' ? now : null,
          },
        );
        if (scenario === 'claim lost') mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
        const result = service.resetPassword(rawToken, 'NewPassword123!');
        await expect(result).rejects.toBeInstanceOf(BadRequestException);
        await expect(result).rejects.toHaveProperty('message', 'Invalid or expired reset token');
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      },
    );

    it('hides delivery failures after persisting the token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      const error = new Error('delivery unavailable');
      delivery.sendPasswordReset.mockRejectedValue(error);
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      try {
        expect(await service.forgotPassword('doctor@test.com')).toEqual(publicResponse);
        expect(mockPrisma.passwordResetToken.upsert).toHaveBeenCalledTimes(1);
        expect(delivery.sendPasswordReset).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith({ message: 'Password reset email delivery failed', userId: 'user-123' });
        const logged = JSON.stringify(log.mock.calls);
        for (const secret of ['doctor@test.com', delivery.sendPasswordReset.mock.calls[0][0].token, error.message]) {
          expect(logged).not.toContain(secret);
        }
      } finally { log.mockRestore(); }
    });

    it.each([30000, 59999])('keeps cooldown active at %i ms without issuing or sending', async (age) => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({ ...validToken(), expiresAt: new Date(now.getTime() + 1800000 - age) });
      expect(await service.forgotPassword('doctor@test.com')).toEqual(publicResponse);
      expect(mockPrisma.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
      expect(mockPrisma.passwordResetToken.upsert).not.toHaveBeenCalled();
      expect(delivery.sendPasswordReset).not.toHaveBeenCalled();
    });

    it.each(['exactly 60 seconds', 'used', 'expired'])('allows another request for a token %s', async (scenario) => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        ...validToken(), usedAt: scenario === 'used' ? now : null,
        expiresAt: new Date(now.getTime() + (scenario === 'expired' ? -1 : scenario === 'exactly 60 seconds' ? 1740000 : 1800000)),
      });
      expect(await service.forgotPassword('doctor@test.com')).toEqual(publicResponse);
      expect(mockPrisma.passwordResetToken.upsert).toHaveBeenCalledTimes(1);
      expect(delivery.sendPasswordReset).toHaveBeenCalledTimes(1);
    });

    it('keeps the persisted token and cooldown after a delivery failure', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      delivery.sendPasswordReset.mockRejectedValue(new Error('delivery unavailable'));
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      try {
        expect(await service.forgotPassword('doctor@test.com')).toEqual(publicResponse);
        mockPrisma.passwordResetToken.findUnique.mockResolvedValue(mockPrisma.passwordResetToken.upsert.mock.calls[0][0].create);
        jest.setSystemTime(new Date(now.getTime() + 30000));
        expect(await service.forgotPassword('doctor@test.com')).toEqual(publicResponse);
        expect(mockPrisma.passwordResetToken.upsert).toHaveBeenCalledTimes(1);
        expect(delivery.sendPasswordReset).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledTimes(1);
      } finally { log.mockRestore(); }
    });

    it('propagates database failures unchanged', async () => {
      const error = new Error('database unavailable');
      mockPrisma.passwordResetToken.updateMany.mockRejectedValue(error);
      await expect(service.resetPassword(rawToken, 'NewPassword123!')).rejects.toBe(error);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('converts a P2002 create error into an email conflict', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );
      const result = service.register({
        email: 'concurrent@test.com', password: 'Password123!',
        firstName: 'Concurrent', lastName: 'Doctor',
      });
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toHaveProperty('message', 'Email already registered');
    });

    it('rethrows a non-P2002 create error unchanged', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const dbError = new Error('db down');
      mockPrisma.user.create.mockRejectedValueOnce(dbError);
      await expect(service.register({
        email: 'concurrent@test.com', password: 'Password123!',
        firstName: 'Concurrent', lastName: 'Doctor',
      })).rejects.toBe(dbError);
    });

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

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: {
          email: dto.email,
        },
      });

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
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

      expect(result).not.toHaveProperty('passwordHash');
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

      const createCall = mockPrisma.user.create.mock.calls[0][0];
      const passwordHash = createCall.data.passwordHash;

      expect(passwordHash).not.toBe(dto.password);
      expect(await argon2.verify(passwordHash, dto.password)).toBe(true);
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

      await expect(service.register(dto)).rejects.toThrow(
        new ConflictException('Email already registered'),
      );

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should login with valid credentials and return access and refresh tokens', async () => {
      const passwordHash = await argon2.hash('password123');

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        passwordHash,
        role: 'DOCTOR',
      });

      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token-123')
        .mockResolvedValueOnce('refresh-token-123');

      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        refreshTokenHash: 'hashed-refresh-token',
      });

      const dto = {
        email: 'doctor@test.com',
        password: 'password123',
      };

      const result = await service.login(dto);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: {
          email: dto.email,
        },
      });

      expect(mockJwtService.signAsync).toHaveBeenCalledTimes(2);

      expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          sub: 'user-123',
          email: 'doctor@test.com',
          role: 'DOCTOR',
          type: 'access',
          jti: expect.any(String),
        }),
        {
          expiresIn: '15m',
        },
      );

      expect(mockJwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sub: 'user-123',
          email: 'doctor@test.com',
          role: 'DOCTOR',
          type: 'refresh',
          jti: expect.any(String),
        }),
        {
          expiresIn: '14d',
        },
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: {
          id: 'user-123',
        },
        data: {
          refreshTokenHash: expect.any(String),
        },
      });

      const updateCall = mockPrisma.user.update.mock.calls[0][0];

      expect(updateCall.data.refreshTokenHash).not.toBe(
        'refresh-token-123',
      );

      expect(result).toEqual({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
      });
    });

    it('should hash the refresh token before storing it', async () => {
      const passwordHash = await argon2.hash('password123');

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        passwordHash,
        role: 'DOCTOR',
      });

      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token-123')
        .mockResolvedValueOnce('refresh-token-123');

      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        refreshTokenHash: 'hashed-refresh-token',
      });

      await service.login({
        email: 'doctor@test.com',
        password: 'password123',
      });

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      const storedHash = updateCall.data.refreshTokenHash;

      expect(storedHash).not.toBe('refresh-token-123');
      expect(
        await argon2.verify(storedHash, 'refresh-token-123'),
      ).toBe(true);
    });

    it('should throw if the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'unknown@test.com',
          password: 'password123',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );

      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should throw if the password is incorrect', async () => {
      const passwordHash = await argon2.hash('correct-password');

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        passwordHash,
        role: 'DOCTOR',
      });

      await expect(
        service.login({
          email: 'doctor@test.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );

      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should return new access and refresh tokens', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        type: 'refresh',
        jti: 'refresh-jti-123',
      });

      const storedHash = await argon2.hash('refresh-token-123');

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        refreshTokenHash: storedHash,
      });

      mockJwtService.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');

      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        refreshTokenHash: 'new-hash',
      });

      const result = await service.refresh('refresh-token-123');

      expect(mockJwtService.verifyAsync).toHaveBeenCalledWith(
        'refresh-token-123',
      );

      expect(mockJwtService.signAsync).toHaveBeenCalledTimes(2);

      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'user-123',
          refreshTokenHash: storedHash,
        },
        data: {
          refreshTokenHash: expect.any(String),
        },
      });
    });

    it('should reject an access token used as refresh token', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        type: 'access',
        jti: 'access-jti-123',
      });

      await expect(
        service.refresh('access-token'),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should reject an invalid refresh token', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(
        new Error('Invalid token'),
      );

      await expect(
        service.refresh('invalid-refresh-token'),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should reject a refresh token that is not stored for the user', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        type: 'refresh',
        jti: 'refresh-jti-123',
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        refreshTokenHash: null,
      });

      await expect(
        service.refresh('refresh-token-123'),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should reject a refresh token with an invalid hash', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        type: 'refresh',
        jti: 'refresh-jti-123',
      });

      const differentTokenHash = await argon2.hash(
        'different-refresh-token',
      );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'doctor@test.com',
        role: 'DOCTOR',
        refreshTokenHash: differentTokenHash,
      });

      await expect(
        service.refresh('refresh-token-123'),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('rotation failures', () => {
    async function ready() {
      const hash = await argon2.hash('old-refresh');
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-123', type: 'refresh' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123', email: 'doctor@test.com', role: 'DOCTOR', refreshTokenHash: hash });
      mockJwtService.signAsync.mockResolvedValue('new-token');
    }

    it('rejects a lost conditional update without overwriting the current session', async () => {
      await ready();
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.refresh('old-refresh')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('does not turn a database read failure into unauthorized', async () => {
      await ready();
      const failure = new Error('Database unavailable');
      mockPrisma.user.findUnique.mockRejectedValueOnce(failure);
      await expect(service.refresh('old-refresh')).rejects.toBe(failure);
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('does not turn a database write failure into unauthorized', async () => {
      await ready();
      const failure = new Error('Database unavailable');
      mockPrisma.user.updateMany.mockRejectedValueOnce(failure);
      await expect(service.refresh('old-refresh')).rejects.toBe(failure);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a missing token before reading the database', async () => {
      await expect(service.refresh(undefined as any)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should remove the refresh token hash', async () => {
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        refreshTokenHash: null,
      });

      const result = await service.logout('user-123');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
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
