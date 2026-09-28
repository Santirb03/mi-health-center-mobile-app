import { Controller, Get, Patch, Param, Req, UseGuards, NotFoundException, ParseUUIDPipe, Module } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

type AuthRequest = { user: { userId: string } };

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() req: AuthRequest) {
    const userId = req.user.userId;
    const [items, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  @Patch('read-all')
  async readAll(@Req() req: AuthRequest) {
    await this.prisma.notification.updateMany({ where: { userId: req.user.userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Patch(':id/read')
  async read(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    const where = { id, userId: req.user.userId };
    if (!await this.prisma.notification.findFirst({ where })) throw new NotFoundException();
    await this.prisma.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}

@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
