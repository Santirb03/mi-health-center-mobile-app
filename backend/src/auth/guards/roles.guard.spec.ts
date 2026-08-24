import {
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';

import { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
    let guard: RolesGuard;

    const mockReflector = {
        getAllAndOverride: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();

        guard = new RolesGuard(
            mockReflector as unknown as Reflector,
        );
    });

    function createContext(user?: {
        role: string;
    }): ExecutionContext {
        return {
            getHandler: jest.fn(),
            getClass: jest.fn(),

            switchToHttp: jest.fn().mockReturnValue({
                getRequest: jest.fn().mockReturnValue({
                    user,
                }),
            }),
        } as unknown as ExecutionContext;
    }

    it('should allow access when no roles are required', () => {
        mockReflector.getAllAndOverride.mockReturnValue(
            undefined,
        );

        const context =
            createContext({
                role: 'DOCTOR',
            });

        expect(
            guard.canActivate(context),
        ).toBe(true);
    });

    it('should allow an ADMIN to access an ADMIN route', () => {
        mockReflector.getAllAndOverride.mockReturnValue(
            ['ADMIN'],
        );

        const context =
            createContext({
                role: 'ADMIN',
            });

        expect(
            guard.canActivate(context),
        ).toBe(true);
    });

    it('should reject a DOCTOR from an ADMIN route', () => {
        mockReflector.getAllAndOverride.mockReturnValue(
            ['ADMIN'],
        );

        const context =
            createContext({
                role: 'DOCTOR',
            });

        expect(() =>
            guard.canActivate(context),
        ).toThrow(
            new ForbiddenException(
                'Insufficient permissions',
            ),
        );
    });

    it('should reject an unauthenticated user', () => {
        mockReflector.getAllAndOverride.mockReturnValue(
            ['ADMIN'],
        );

        const context =
            createContext(undefined);

        expect(() =>
            guard.canActivate(context),
        ).toThrow(
            new ForbiddenException(
                'User not authenticated',
            ),
        );
    });
});