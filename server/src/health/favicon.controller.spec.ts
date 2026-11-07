import { FaviconController } from './favicon.controller.js';
import { IS_PUBLIC_KEY } from '../common/auth/roles.decorator.js';

describe('FaviconController (R25)', () => {
  it('is public and returns nothing', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FaviconController)).toBe(true);
    expect(new FaviconController().favicon()).toBeUndefined();
  });

  it('answers 204 with a day of cache', () => {
    const handler = FaviconController.prototype.favicon;
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(204);
    const headers = Reflect.getMetadata('__headers__', handler) as Array<{
      name: string;
      value: string;
    }>;
    expect(headers).toContainEqual({
      name: 'Cache-Control',
      value: 'public, max-age=86400',
    });
  });
});
