import {
    Body,
    Controller,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';

import { Request } from 'express';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

interface AuthenticatedRequest extends Request {
    user: {
        userId: string;
        email: string;
        role: string;
    };
}

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
    ) { }

    @Post('register')
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('login')
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    @Post('refresh')
    refresh(
        @Body('refreshToken') refreshToken: string,
    ) {
        return this.authService.refresh(refreshToken);
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    logout(
        @Req() req: AuthenticatedRequest,
    ) {
        return this.authService.logout(
            req.user.userId,
        );
    }
}