import { isIP } from 'node:net';

/** Validate at startup; errors contain variable names, never their values. */
export function validateEnvironment(config: Record<string, unknown>) {
  const errors: string[] = [];
  if (
    config.TRUST_PROXY_IPS !== undefined &&
    (typeof config.TRUST_PROXY_IPS !== 'string' ||
      (config.TRUST_PROXY_IPS !== '' &&
        !config.TRUST_PROXY_IPS.split(',').every((ip) => isIP(ip.trim()))))
  ) {
    errors.push(
      'TRUST_PROXY_IPS: expected a comma-separated list of proxy IP addresses',
    );
  }
  const required = (name: string): string => {
    const value = config[name];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${name}: required`);
      return '';
    }
    if (value !== value.trim()) errors.push(`${name}: surrounding whitespace`);
    return value;
  };
  const databaseUrl = required('DATABASE_URL');
  try {
    const url = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length <= 1 ||
      url.hash
    ) {
      throw new Error();
    }
  } catch {
    errors.push(
      'DATABASE_URL: expected a PostgreSQL URL with host and database',
    );
  }
  const jwt = required('JWT_SECRET');
  const stripe = required('STRIPE_SECRET_KEY');
  if (!/^(sk|rk)_(test|live)_.+$/u.test(stripe)) {
    errors.push(
      'STRIPE_SECRET_KEY: expected a Stripe secret or restricted key',
    );
  }
  const webhook = required('STRIPE_WEBHOOK_SECRET');
  if (!/^whsec_.+$/u.test(webhook)) {
    errors.push('STRIPE_WEBHOOK_SECRET: expected a webhook signing secret');
  }
  const nodeEnv = config.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(String(nodeEnv))) {
    errors.push('NODE_ENV: expected development, test or production');
  }
  if (nodeEnv === 'production' && jwt.length < 32) {
    errors.push('JWT_SECRET: at least 32 characters required in production');
  }
  const port = config.PORT ?? '3000';
  if (
    !/^\d+$/u.test(String(port)) ||
    Number(port) < 1 ||
    Number(port) > 65535
  ) {
    errors.push('PORT: expected an integer between 1 and 65535');
  }
  if (errors.length)
    throw new Error(`Invalid server configuration: ${errors.join('; ')}`);
  return { ...config, NODE_ENV: nodeEnv, PORT: Number(port) };
}
