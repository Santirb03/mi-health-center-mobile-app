import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

if (
  process.env.AUTH_INTEGRATION_ISOLATED !== '1' ||
  new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !==
    '/mhc_payment_test'
) {
  throw new Error(
    'Use npm run test:auth:integration (disposable database required)',
  );
}
jest.setTimeout(30000);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Refresh rotation with independent PostgreSQL clients', () => {
  let first: PrismaService;
  let second: PrismaService;
  let auth: AuthService;
  let other: AuthService;
  const jwt = new JwtService({ secret: 'auth-integration-only-secret' });
  beforeAll(async () => {
    first = new PrismaService();
    second = new PrismaService();
    await Promise.all([first.$connect(), second.$connect()]);
    auth = new AuthService(first, jwt);
    other = new AuthService(second, jwt);
  });
  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  async function fixture() {
    const password = 'integration-password-only';
    const user = await first.user.create({
      data: {
        email: `${randomUUID()}@integration.invalid`,
        passwordHash: await argon2.hash(password),
      },
    });
    const tokens = await auth.login({ email: user.email, password });
    return { user, tokens, password };
  }
  async function stored(id: string) {
    return (await first.user.findUniqueOrThrow({ where: { id } }))
      .refreshTokenHash;
  }

  // Only schedule the moment before the write; the write and its WHERE
  // predicate run in real PostgreSQL, with real JWT signing and Argon2.
  function pausedService(
    client: PrismaService,
    beforeWrite: () => Promise<void>,
  ) {
    return new AuthService(
      {
        user: {
          findUnique: (args: any) => client.user.findUnique(args),
          updateMany: async (args: any) => {
            await beforeWrite();
            return client.user.updateMany(args);
          },
        },
      } as unknown as PrismaService,
      jwt,
    );
  }

  it('allows exactly one concurrent rotation and keeps the winning hash on replay', async () => {
    const f = await fixture();
    const both = deferred();
    const release = deferred();
    let arrivals = 0;
    const before = async () => {
      if (++arrivals === 2) both.resolve();
      await release.promise;
    };
    const results = Promise.allSettled([
      pausedService(first, before).refresh(f.tokens.refreshToken),
      pausedService(second, before).refresh(f.tokens.refreshToken),
    ]);
    await both.promise;
    release.resolve();
    const settled = await results;
    const successes = settled.filter(
      (
        r,
      ): r is PromiseFulfilledResult<{
        accessToken: string;
        refreshToken: string;
      }> => r.status === 'fulfilled',
    );
    expect(successes).toHaveLength(1);
    const rejected = settled.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(UnauthorizedException);
    const hash = await stored(f.user.id);
    expect(await argon2.verify(hash!, successes[0].value.refreshToken)).toBe(
      true,
    );
    await expect(other.refresh(f.tokens.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(await stored(f.user.id)).toBe(hash);
    await expect(
      other.refresh(successes[0].value.refreshToken),
    ).resolves.toHaveProperty('accessToken');
  });

  it('logout before the conditional write prevents a stale refresh from resurrecting the session', async () => {
    const f = await fixture();
    const arrived = deferred();
    const release = deferred();
    const result = pausedService(first, async () => {
      arrived.resolve();
      await release.promise;
    })
      .refresh(f.tokens.refreshToken)
      .catch((error) => error);
    await arrived.promise;
    await other.logout(f.user.id);
    release.resolve();
    expect(await result).toBeInstanceOf(UnauthorizedException);
    expect(await stored(f.user.id)).toBeNull();
    await expect(auth.refresh(f.tokens.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('logout after a completed refresh revokes the newly issued refresh token', async () => {
    const f = await fixture();
    const rotated = await auth.refresh(f.tokens.refreshToken);
    await other.logout(f.user.id);
    expect(await stored(f.user.id)).toBeNull();
    await expect(auth.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('a new password login wins over an older in-flight refresh', async () => {
    const f = await fixture();
    const arrived = deferred();
    const release = deferred();
    const result = pausedService(first, async () => {
      arrived.resolve();
      await release.promise;
    })
      .refresh(f.tokens.refreshToken)
      .catch((error) => error);
    await arrived.promise;
    const login = await other.login({
      email: f.user.email,
      password: f.password,
    });
    release.resolve();
    expect(await result).toBeInstanceOf(UnauthorizedException);
    expect(
      await argon2.verify((await stored(f.user.id))!, login.refreshToken),
    ).toBe(true);
  });

  it('refresh obtains the current role from the database instead of copying stale claims', async () => {
    const f = await fixture();
    await first.user.update({
      where: { id: f.user.id },
      data: { role: 'ADMIN' },
    });
    const result = await other.refresh(f.tokens.refreshToken);
    expect(jwt.verify(result.accessToken).role).toBe('ADMIN');
  });
});
