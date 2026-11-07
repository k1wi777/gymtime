import {
  Controller,
  Get,
  Post,
  Req,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { configureHttp, type HttpOptions } from './http-setup.js';

@Controller('probe')
class ProbeController {
  @Get()
  get() {
    return { ok: true };
  }

  @Post()
  post() {
    return { ok: true };
  }

  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

@Controller()
class BodyProbeController {
  @Post('students/import/probe')
  importBody(@Req() req: Request) {
    return { size: (req.body as { content: string }).content.length };
  }

  @Post('other/probe')
  otherBody(@Req() req: Request) {
    return { size: (req.body as { content: string }).content.length };
  }
}

const LISTED = 'http://localhost:3000';
const OTHER = 'http://evil.example';

async function build(options: Partial<HttpOptions> = {}) {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController, BodyProbeController],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureHttp(app, { corsOrigins: [LISTED], trustProxy: 0, ...options });
  await app.init();
  return app;
}

const corsHeaders = (headers: Record<string, unknown>) =>
  Object.keys(headers).filter((name) => name.startsWith('access-control-'));

describe('configureHttp (R19)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  afterEach(() => app.close());

  it('allows a listed origin with credentials and exposes Retry-After', async () => {
    app = await build();
    const res = await http().get('/probe').set('Origin', LISTED).expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(LISTED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toBe('retry-after');
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it('answers the preflight of a listed origin with explicit methods, headers and cache', async () => {
    app = await build();
    const res = await http()
      .options('/probe')
      .set('Origin', LISTED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-gymtime-client')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(LISTED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toBe(
      'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    );
    expect(res.headers['access-control-allow-headers']).toBe(
      'content-type,x-gymtime-client',
    );
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('does not allow x-api-key from a browser', async () => {
    app = await build();
    const res = await http()
      .options('/probe')
      .set('Origin', LISTED)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-api-key')
      .expect(204);
    expect(res.headers['access-control-allow-headers']).not.toMatch(/api-key/);
  });

  it('emits no CORS header for an unlisted origin, not even on the preflight', async () => {
    app = await build();
    const read = await http().get('/probe').set('Origin', OTHER).expect(200);
    expect(corsHeaders(read.headers)).toEqual([]);
    const preflight = await http()
      .options('/probe')
      .set('Origin', OTHER)
      .set('Access-Control-Request-Method', 'POST');
    // Not answered as a preflight: the browser has no permission to go on.
    expect(corsHeaders(preflight.headers)).toEqual([]);
  });

  it('is exact: scheme, host and port must match', async () => {
    app = await build();
    for (const origin of [
      'https://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3000.evil.example',
      'null',
    ]) {
      const res = await http().get('/probe').set('Origin', origin).expect(200);
      expect(corsHeaders(res.headers), origin).toEqual([]);
    }
  });

  it('emits nothing without Origin or with no configured origin', async () => {
    app = await build();
    expect(
      corsHeaders((await http().get('/probe').expect(200)).headers),
    ).toEqual([]);
    await app.close();
    app = await build({ corsOrigins: [] });
    const res = await http().get('/probe').set('Origin', LISTED).expect(200);
    expect(corsHeaders(res.headers)).toEqual([]);
  });
});

describe('configureHttp body limit of the CSV import', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('accepts a large body only on the import routes', async () => {
    app = await build();
    const content = 'x'.repeat(500_000);
    const accepted = await request(app.getHttpServer())
      .post('/students/import/probe')
      .send({ content })
      .expect(201);
    expect(accepted.body).toEqual({ size: 500_000 });
    // Elsewhere the default 100 kb limit still applies.
    const rejected = await request(app.getHttpServer())
      .post('/other/probe')
      .send({ content });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
  });
});

describe('configureHttp trust proxy', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('ignores X-Forwarded-For by default', async () => {
    app = await build();
    const res = await request(app.getHttpServer())
      .get('/probe/ip')
      .set('X-Forwarded-For', '203.0.113.9');
    expect(res.body.ip).not.toBe('203.0.113.9');
  });

  it('reads the client IP behind the configured number of proxies', async () => {
    app = await build({ trustProxy: 1 });
    const res = await request(app.getHttpServer())
      .get('/probe/ip')
      .set('X-Forwarded-For', '203.0.113.9');
    expect(res.body.ip).toBe('203.0.113.9');
  });
});

describe('configureHttp security headers', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('sets the API headers, hides x-powered-by and answers preflights with them', async () => {
    app = await build();
    const res = await request(app.getHttpServer()).get('/probe').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
    const preflight = await request(app.getHttpServer())
      .options('/probe')
      .set('Origin', LISTED)
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sends HSTS only in production and only over HTTPS behind the proxy', async () => {
    app = await build({ production: true, trustProxy: 1 });
    const https = await request(app.getHttpServer())
      .get('/probe')
      .set('X-Forwarded-Proto', 'https');
    expect(https.headers['strict-transport-security']).toMatch(
      /max-age=31536000/,
    );
    const http = await request(app.getHttpServer()).get('/probe');
    expect(http.headers['strict-transport-security']).toBeUndefined();
  });

  it('never sends HSTS outside production', async () => {
    app = await build({ production: false, trustProxy: 1 });
    const res = await request(app.getHttpServer())
      .get('/probe')
      .set('X-Forwarded-Proto', 'https');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});
