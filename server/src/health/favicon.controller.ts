import { Controller, Get, Header, HttpCode } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../common/auth/roles.decorator.js';

/**
 * Browsers ask for `/favicon.ico` on their own when someone opens the API (or
 * its docs). The API has no icon: answering 204 without a credential keeps the
 * log free of 404s and of authentication errors for a request nobody made.
 */
@Public()
@ApiExcludeController()
@Controller('favicon.ico')
export class FaviconController {
  @Get()
  @HttpCode(204)
  @Header('Cache-Control', 'public, max-age=86400')
  favicon(): void {
    // Intentionally empty.
  }
}
