import {
    ConflictException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
    ) { }

    async register(dto: RegisterDto) {
        const existingUser = await this.prisma.user.findUnique({
            where: {
                email: dto.email,
            },
        });

        if (existingUser) {
            throw new ConflictException(
                'Email already registered',
            );
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
            throw new UnauthorizedException(
                'Invalid credentials',
            );
        }

        const passwordValid = await argon2.verify(
            user.passwordHash,
            dto.password,
        );

        if (!passwordValid) {
            throw new UnauthorizedException(
                'Invalid credentials',
            );
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
    ) {
        const payload = {
            sub: userId,
            email,
            role,
        };

        // Access token
        const accessToken =
            await this.jwtService.signAsync(payload);

        // Refresh token
        const refreshToken =
            await this.jwtService.signAsync(
                payload,
                {
                    expiresIn: '7d',
                },
            );

        // NEVER store the refresh token itself.
        // Store only its Argon2 hash.
        const refreshTokenHash =
            await argon2.hash(refreshToken);

        await this.prisma.user.update({
            where: {
                id: userId,
            },

            data: {
                refreshTokenHash,
            },
        });

        return {
            accessToken,
            refreshToken,
        };
    }

    async refresh(refreshToken: string) {
        try {
            const payload =
                await this.jwtService.verifyAsync<{
                    sub: string;
                    email: string;
                    role: string;
                }>(refreshToken);

            const user =
                await this.prisma.user.findUnique({
                    where: {
                        id: payload.sub,
                    },
                });

            if (!user || !user.refreshTokenHash) {
                throw new UnauthorizedException(
                    'Invalid refresh token',
                );
            }

            const tokenValid =
                await argon2.verify(
                    user.refreshTokenHash,
                    refreshToken,
                );

            if (!tokenValid) {
                throw new UnauthorizedException(
                    'Invalid refresh token',
                );
            }

            // Token rotation:
            // the old refresh token becomes invalid
            // because a new hash is stored.
            return this.generateTokens(
                user.id,
                user.email,
                user.role,
            );
        } catch {
            throw new UnauthorizedException(
                'Invalid refresh token',
            );
        }
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