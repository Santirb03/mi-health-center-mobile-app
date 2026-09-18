import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  private databaseProbe?: Promise<unknown>;

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Share an outstanding query so repeated probes cannot accumulate
      // database work if the connection stalls. The deadline bounds HTTP only.
      if (!this.databaseProbe) {
        this.databaseProbe = Promise.resolve()
          .then(() => this.prisma.$queryRaw`SELECT 1`)
          .finally(() => {
            this.databaseProbe = undefined;
          });
      }
      await Promise.race([
        this.databaseProbe,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Probe timeout')), 2000);
        }),
      ]);
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        database: 'down',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
