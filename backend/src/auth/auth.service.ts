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

    async register(dto: RegisterDto) {
        const existingUser =
            await this.prisma.user.findUnique({
                where: {
                    email: dto.email,
                },
            });

        if (existingUser) {
            throw new ConflictException(
                'Email already registered',
            );
        }

        const passwordHash =
            await argon2.hash(dto.password);

        const user =
            await this.prisma.user.create({
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
        const user =
            await this.prisma.user.findUnique({
                where: {
                    email: dto.email,
                },
            });

        if (!user) {
            throw new UnauthorizedException(
                'Invalid credentials',
            );
        }

        const passwordValid =
            await argon2.verify(
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
        /*
         * =========================
         * ACCESS TOKEN
         * =========================
         *
         * Every access token receives
         * its own unique JTI.
         *
         * This guarantees that two tokens
         * generated in the same second are
         * still different.
         */
        const accessToken =
            await this.jwtService.signAsync(
                {
                    sub: userId,
                    email,
                    role,
                    type: 'access',
                    jti: randomUUID(),
                },
                {
                    expiresIn: '1h',
                },
            );

        /*
         * =========================
         * REFRESH TOKEN
         * =========================
         *
         * Every refresh token also receives
         * a unique JTI.
         */
        const refreshToken =
            await this.jwtService.signAsync(
                {
                    sub: userId,
                    email,
                    role,
                    type: 'refresh',
                    jti: randomUUID(),
                },
                {
                    expiresIn: '7d',
                },
            );

        /*
         * NEVER store the raw refresh token.
         *
         * Only its Argon2 hash is stored.
         */
        const refreshTokenHash =
            await argon2.hash(refreshToken);

        /*
         * Store the new refresh token hash.
         *
         * This is what implements refresh-token
         * rotation.
         *
         * Once this update succeeds, the previous
         * refresh token is no longer valid.
         */
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
            /*
             * =========================
             * 1. VERIFY JWT
             * =========================
             */
            const payload =
                await this.jwtService.verifyAsync<{
                    sub: string;
                    email: string;
                    role: string;
                    type: string;
                    jti: string;
                }>(refreshToken);

            /*
             * =========================
             * 2. MAKE SURE IT IS A
             *    REFRESH TOKEN
             * =========================
             */
            if (payload.type !== 'refresh') {
                throw new UnauthorizedException(
                    'Invalid refresh token',
                );
            }

            /*
             * =========================
             * 3. FIND USER
             * =========================
             */
            const user =
                await this.prisma.user.findUnique({
                    where: {
                        id: payload.sub,
                    },
                });

            if (
                !user ||
                !user.refreshTokenHash
            ) {
                throw new UnauthorizedException(
                    'Invalid refresh token',
                );
            }

            /*
             * =========================
             * 4. COMPARE TOKEN AGAINST
             *    STORED HASH
             * =========================
             */
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

            /*
             * =========================
             * 5. ROTATE TOKENS
             * =========================
             *
             * generateTokens() creates:
             *
             * - new access token
             * - new refresh token
             * - new refresh token hash
             *
             * The old refresh token therefore
             * becomes invalid.
             */
            return await this.generateTokens(
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