import 'reflect-metadata';
import { DynamicModule, RequestMethod, Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ROLES_KEY } from './auth/decorators/roles.decorator';

const manifest = {
  public: [
    'GET /', 'GET /health', 'GET /health/ready', 'GET /rooms',
    'GET /rooms/:id', 'GET /rooms/:id/availability',
  ],
  throttled: ['POST /auth/login', 'POST /auth/refresh', 'POST /auth/register',
    'POST /auth/forgot-password', 'POST /auth/reset-password'],
  webhook: ['POST /payments/webhook'],
  jwt: [
    'GET /protected', 'GET /auth/me', 'POST /auth/logout',
    'GET /notifications', 'PATCH /notifications/read-all',
    'PATCH /notifications/:id/read', 'GET /patients', 'POST /patients',
    'GET /patients/:id', 'PATCH /patients/:id', 'GET /reservations',
    'POST /reservations', 'GET /reservations/page', 'GET /reservations/calendar', 'GET /reservations/:id',
    'PATCH /reservations/:id/cancel', 'POST /payments/reservations/:reservationId',
  ],
  admin: [
    'GET /admin/agenda', 'GET /admin/rooms', 'POST /rooms', 'PATCH /rooms/:id',
    'DELETE /rooms/:id', 'GET /rooms/:id/blocks', 'POST /rooms/:id/blocks',
    'DELETE /rooms/:id/blocks/:blockId',
  ],
} satisfies Record<string, string[]>;

type Route = { key: string; guards: string[]; hasRoles: boolean };
type ModuleReference = Type<unknown> | DynamicModule;

async function discoverRoutes(root: ModuleReference): Promise<Route[]> {
  const visited = new Set<ModuleReference>();
  const controllers = new Set<Type<unknown>>();
  async function visit(reference: ModuleReference | Promise<DynamicModule>) {
    const resolved = await reference;
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const dynamic = typeof resolved === 'function' ? undefined : resolved;
    const moduleClass = dynamic?.module ?? resolved as Type<unknown>;
    for (const controller of [
      ...(Reflect.getMetadata('controllers', moduleClass) ?? []),
      ...(dynamic?.controllers ?? []),
    ]) controllers.add(controller);
    for (const imported of [
      ...(Reflect.getMetadata('imports', moduleClass) ?? []),
      ...(dynamic?.imports ?? []),
    ]) {
      await visit(imported?.forwardRef ? imported.forwardRef() : imported);
    }
  }
  await visit(root);
  const routes: Route[] = [];
  const paths = (value: string | string[] | undefined): string[] =>
    Array.isArray(value) ? value : [value ?? ''];
  for (const controller of controllers) {
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
      if (typeof handler !== 'function') continue;
      const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      const guards: string[] = [
        ...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []),
        ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
      ].map((guard: { name: string }) => guard.name);
      const hasRoles = Reflect.hasMetadata(ROLES_KEY, controller)
        || Reflect.hasMetadata(ROLES_KEY, handler);
      for (const base of paths(Reflect.getMetadata(PATH_METADATA, controller))) {
        for (const path of paths(Reflect.getMetadata(PATH_METADATA, handler))) {
          const normalized = `/${base}/${path}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
          routes.push({ key: `${RequestMethod[method]} ${normalized}`, guards, hasRoles });
        }
      }
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

describe('HTTP route authorization inventory', () => {
  // Only class/handler @UseGuards metadata is audited. If global guards are
  // introduced (APP_GUARD/useGlobalGuards), explicitly extend this inventory.
  // Webhook signature verification belongs to handler tests, not this audit.
  const environment = {
    E2E_INTEGRATION_ISOLATED: '1',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    JWT_SECRET: 'route-authorization-test-secret-at-least-32-characters',
    NODE_ENV: 'test',
    PORT: '3000',
    TRUST_PROXY_IPS: '',
  };
  const previous = new Map<string, string | undefined>();
  let routes: Route[];
  beforeAll(async () => {
    for (const [key, value] of Object.entries(environment)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    // Import real modules only after configuration is set; never instantiate Nest.
    const { AppModule } = require('./app.module') as typeof import('./app.module');
    routes = await discoverRoutes(AppModule);
  });
  afterAll(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('matches the explicit manifest of 37 routes', () => {
    const expected = Object.values(manifest).flat().sort();
    const discovered = routes.map(({ key }) => key).sort();
    const errors = [
      ...discovered.filter((key) => !expected.includes(key))
        .map((key) => `Ruta sin clasificar: ${key}`),
      ...expected.filter((key) => !discovered.includes(key))
        .map((key) => `Entrada obsoleta en el manifiesto: ${key}`),
    ];
    if (errors.length) throw new Error(errors.join('\n'));
    expect(new Set(expected).size).toBe(expected.length);
    expect(new Set(discovered).size).toBe(discovered.length);
    expect(routes).toHaveLength(37);
  });

  for (const [category, keys] of Object.entries(manifest)) {
    for (const key of [...keys].sort()) {
      it(`${category}: ${key}`, () => {
        const route = routes.find((entry) => entry.key === key);
        expect(route).toBeDefined();
        const guards = route!.guards;
        if (category === 'admin' || category === 'jwt') {
          expect(guards).toContain('JwtAuthGuard');
        } else {
          expect(guards).not.toContain('JwtAuthGuard');
        }
        if (category === 'admin') {
          expect(guards).toContain('AdminAccessGuard');
          expect(guards.indexOf('JwtAuthGuard')).toBeLessThan(guards.indexOf('AdminAccessGuard'));
        } else {
          expect(guards).not.toContain('AdminAccessGuard');
        }
        if (category === 'throttled') expect(guards).toContain('ThrottlerGuard');
      });
    }
  }

  it('requires AdminAccessGuard for every @Roles declaration and rejects duplicate guards', () => {
    const errors: string[] = [];
    for (const { key, guards, hasRoles } of routes) {
      if (hasRoles && !guards.includes('AdminAccessGuard')) {
        errors.push(`${key}: @Roles requiere AdminAccessGuard`);
      }
      if (new Set(guards).size !== guards.length) {
        errors.push(`${key}: guards duplicados: ${guards.join(', ')}`);
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
  });
});
