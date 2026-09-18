import { validateEnvironment } from './environment';

const valid = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/test',
  JWT_SECRET: 'test-secret',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
};

describe('server configuration', () => {
  it('defaults to development and a numeric port without altering secrets', () => {
    expect(validateEnvironment(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      PORT: 3000,
    });
  });
  it('accepts production configuration, restricted keys and an explicit port', () => {
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(32),
        STRIPE_SECRET_KEY: 'rk_test_fake',
        PORT: '8080',
      }).PORT,
    ).toBe(8080);
  });
  it.each(Object.keys(valid))('rejects missing %s', (key) => {
    expect(() => validateEnvironment({ ...valid, [key]: undefined })).toThrow(
      key,
    );
    expect(() => validateEnvironment({ ...valid, [key]: '  ' })).toThrow(key);
  });
  it.each(['0', '65536', '-1', '3.5', 'abc', '', ' 3000', '3e3'])(
    'rejects invalid port %s',
    (PORT) => {
      expect(() => validateEnvironment({ ...valid, PORT })).toThrow('PORT');
    },
  );
  it.each(['https://host/db', 'postgresql://host', 'invalid'])(
    'rejects invalid database URLs',
    (DATABASE_URL) => {
      expect(() => validateEnvironment({ ...valid, DATABASE_URL })).toThrow(
        'DATABASE_URL',
      );
    },
  );
  it('rejects malformed keys, whitespace, environment and a short production secret', () => {
    for (const override of [
      { STRIPE_SECRET_KEY: 'pk_test_fake' },
      { STRIPE_WEBHOOK_SECRET: 'wrong' },
      { JWT_SECRET: ' secret ' },
      { NODE_ENV: 'staging' },
      { NODE_ENV: 'production' },
    ])
      expect(() => validateEnvironment({ ...valid, ...override })).toThrow();
  });
  it('reports all missing fields without exposing supplied secrets', () => {
    const sensitive = 'private-value-never-log';
    try {
      validateEnvironment({
        DATABASE_URL: sensitive,
        STRIPE_SECRET_KEY: sensitive,
      });
      throw new Error('validation did not reject');
    } catch (error) {
      expect((error as Error).message).not.toContain(sensitive);
      for (const key of Object.keys(valid))
        expect((error as Error).message).toContain(key);
    }
  });
});
