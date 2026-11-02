import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// Global so future Prisma repositories receive the client by injection.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
