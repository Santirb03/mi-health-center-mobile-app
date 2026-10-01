import { validateEnvironment } from './environment';

const valid = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/test',
  JWT_SECRET: 'test-secret',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
};

describe('server configuration', () => {
  const emailConfig = {
    PASSWORD_RESET_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'synthetic-test-only',
    PASSWORD_RESET_FROM: 'Test <reset@example.invalid>', PASSWORD_RESET_URL: 'https://example.invalid/reset',
  };
  it.each([undefined, 'false', false])('allows disabled email without credentials (%s)', (enabled) => {
    expect(validateEnvironment({ ...valid, PASSWORD_RESET_EMAIL_ENABLED: enabled })
      .PASSWORD_RESET_EMAIL_ENABLED).toBe(false);
  });
  it('requires HTTPS in production without exposing the configured URL', () => {
    const url = 'http://private.example.invalid/reset';
    try {
      validateEnvironment({ ...valid, ...emailConfig, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), PASSWORD_RESET_URL: url });
      throw new Error('validation did not reject');
    } catch (error) {
      expect((error as Error).message).toContain('PASSWORD_RESET_URL');
      expect((error as Error).message).not.toContain(url);
    }
  });
  it.each([
    ['production', 'true', 'https://example.invalid/reset'],
    ['development', 'true', 'http://localhost/reset'],
    ['test', 'true', 'http://localhost/reset'],
    ['production', 'false', 'http://localhost/reset'],
  ])('accepts reset URL for %s with email=%s', (NODE_ENV, PASSWORD_RESET_EMAIL_ENABLED, PASSWORD_RESET_URL) => {
    expect(() => validateEnvironment({ ...valid, ...emailConfig, JWT_SECRET: 'x'.repeat(32),
      NODE_ENV, PASSWORD_RESET_EMAIL_ENABLED, PASSWORD_RESET_URL,
    })).not.toThrow();
  });
  it.each(['true', true])('parses enabled email explicitly (%s)', (enabled) => {
    expect(validateEnvironment({ ...valid, ...emailConfig, PASSWORD_RESET_EMAIL_ENABLED: enabled })
      .PASSWORD_RESET_EMAIL_ENABLED).toBe(true);
  });
  it.each(['', 'yes', '1', 'TRUE', ' false ', 1])('rejects invalid email flag (%s)', (enabled) => {
    expect(() => validateEnvironment({ ...valid, PASSWORD_RESET_EMAIL_ENABLED: enabled }))
      .toThrow('PASSWORD_RESET_EMAIL_ENABLED');
  });
  it.each(['RESEND_API_KEY', 'PASSWORD_RESET_FROM', 'PASSWORD_RESET_URL'])(
    'requires %s when email is enabled', (key) => {
      expect(() => validateEnvironment({ ...valid, ...emailConfig, [key]: '' })).toThrow(key);
    },
  );
  it.each(['not a URL', '/reset', 'javascript:alert(1)', 'mailto:doctor@example.invalid'])(
    'rejects invalid reset destination (%s)', (url) => {
      expect(() => validateEnvironment({ ...valid, ...emailConfig, PASSWORD_RESET_URL: url }))
        .toThrow('PASSWORD_RESET_URL');
    },
  );
  it('does not expose email secrets in configuration errors', () => {
    try {
      validateEnvironment({ ...valid, ...emailConfig, PASSWORD_RESET_URL: 'private-url-value' });
      throw new Error('validation did not reject');
    } catch (error) {
      expect((error as Error).message).toContain('PASSWORD_RESET_URL');
      expect((error as Error).message).not.toContain(emailConfig.RESEND_API_KEY);
      expect((error as Error).message).not.toContain('private-url-value');
    }
  });
  it('only accepts explicit proxy IP addresses', () => {
    for (const TRUST_PROXY_IPS of [
      'true',
      '*',
      '1',
      'localhost',
      '127.0.0.1,',
    ]) {
      expect(() => validateEnvironment({ ...valid, TRUST_PROXY_IPS })).toThrow(
        'TRUST_PROXY_IPS',
      );
    }
    expect(() =>
      validateEnvironment({ ...valid, TRUST_PROXY_IPS: '127.0.0.1, ::1' }),
    ).not.toThrow();
  });
  it('defaults to development and a numeric port without altering secrets', () => {
    expect(validateEnvironment(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      PORT: 3000,
      PASSWORD_RESET_EMAIL_ENABLED: false,
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
