import { Module } from '@nestjs/common';
import { FaviconController } from './favicon.controller.js';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController, FaviconController] })
export class HealthModule {}
