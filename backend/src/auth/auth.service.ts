import {
    ConflictException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
    ) { }

    async me(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId }, select: { id: true, role: true },
        });
        if (!user) throw new UnauthorizedException();
        return user;
    }

    async register(dto: RegisterDto) {
        const existingUser = await this.prisma.user.findUnique({
            where: {
                email: dto.email,
            },
        });

        if (existingUser) {
            throw new ConflictException('Email already registered');
        }

        const passwordHash = await argon2.hash(dto.password);

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash,
                doctorProfile: {
                    create: {
                        firstName: dto.firstName,
                        lastName: dto.lastName,
                        phone: dto.phone,
                        specialty: dto.specialty,
                    },
                },
            },
            include: {
                doctorProfile: true,
            },
        });

        return {
            id: user.id,
            email: user.email,
            role: user.role,
            doctorProfile: user.doctorProfile,
        };
    }

    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({
            where: {
                email: dto.email,
            },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const passwordValid = await argon2.verify(
            user.passwordHash,
            dto.password,
        );

        if (!passwordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        return this.generateTokens(
            user.id,
            user.email,
            user.role,
        );
    }

    private async generateTokens(
        userId: string,
        email: string,
        role: string,
        expectedRefreshHash?: string,
    ) {
        const accessToken = await this.jwtService.signAsync(
            {
                sub: userId,
                email,
                role,
                type: 'access',
                jti: randomUUID(),
            },
            {
                expiresIn: '15m',
            },
        );

        const refreshToken = await this.jwtService.signAsync(
            {
                sub: userId,
                email,
                role,
                type: 'refresh',
                jti: randomUUID(),
            },
            {
                expiresIn: '14d',
            },
        );

        const refreshTokenHash = await argon2.hash(refreshToken);

        if (expectedRefreshHash !== undefined) {
            // Atomic compare-and-swap: a competing refresh, login or logout
            // changes the hash and makes this stale rotation fail.
            const result = await this.prisma.user.updateMany({
                where: { id: userId, refreshTokenHash: expectedRefreshHash },
                data: { refreshTokenHash },
            });
            if (result.count !== 1) throw new UnauthorizedException('Invalid refresh token');
        } else {
            // An explicit password login starts a new session.
            await this.prisma.user.update({
                where: { id: userId }, data: { refreshTokenHash },
            });
        }

        return {
            accessToken,
            refreshToken,
        };
    }

    async refresh(refreshToken: string) {
        if (typeof refreshToken !== 'string' || !refreshToken) {
            throw new UnauthorizedException('Invalid refresh token');
        }
        let payload: { sub: string; type: string };
        try {
            payload = await this.jwtService.verifyAsync(refreshToken);
        } catch {
            throw new UnauthorizedException('Invalid refresh token');
        }
        if (payload?.type !== 'refresh' || typeof payload.sub !== 'string' || !payload.sub) {
            throw new UnauthorizedException('Invalid refresh token');
        }
        // Storage/signing failures must remain server errors, not a false 401
        // that would make mobile discard a potentially valid session.
        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user?.refreshTokenHash) throw new UnauthorizedException('Invalid refresh token');
        const tokenValid = await argon2.verify(user.refreshTokenHash, refreshToken);
        if (!tokenValid) throw new UnauthorizedException('Invalid refresh token');
        return this.generateTokens(user.id, user.email, user.role, user.refreshTokenHash);
    }

    async logout(userId: string) {
        await this.prisma.user.update({
            where: {
                id: userId,
            },
            data: {
                refreshTokenHash: null,
            },
        });

        return {
            message: 'Logged out successfully',
        };
    }
}
