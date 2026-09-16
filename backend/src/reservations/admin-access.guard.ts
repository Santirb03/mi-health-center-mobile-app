import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const userId = context.switchToHttp().getRequest().user?.userId;
    if (!userId) throw new ForbiddenException();
    // Read the current role so an old access token cannot retain revoked privileges.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role !== 'ADMIN') throw new ForbiddenException();
    return true;
  }
}
