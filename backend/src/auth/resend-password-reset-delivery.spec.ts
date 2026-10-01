import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PASSWORD_RESET_DELIVERY, NoopPasswordResetDelivery } from './password-reset-delivery';
import { ResendPasswordResetDelivery, passwordResetDeliveryProvider } from './resend-password-reset-delivery';
import { validateEnvironment } from '../config/environment';

// DI selection may construct the SDK, but no test can reach its network client.
jest.mock('resend', () => ({ Resend: jest.fn() }));

describe('Resend password reset delivery', () => {
  const from = 'Mi Health Center <reset@example.invalid>';
  const input = {
    email: 'doctor@example.com', token: 'synthetic +/?&="<> token',
    expiresAt: new Date('2035-01-01T00:30:00Z'),
  };
  const send = jest.fn();
  let adapter: ResendPasswordResetDelivery;
  beforeEach(() => {
    send.mockReset().mockResolvedValue({ data: { id: 'synthetic-email-id' }, error: null });
    adapter = new ResendPasswordResetDelivery({ from, resetUrl: 'https://example.invalid/reset' }, { emails: { send } });
  });

  it('sends HTML and plain text with the configured sender and encoded token', async () => {
    await adapter.sendPasswordReset(input);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message).toMatchObject({ from, to: input.email, subject: 'Reset your Mi Health Center password' });
    const link = message.text.match(/https:\/\/\S+/)[0];
    const url = new URL(link);
    expect(url.searchParams.get('token')).toBe(input.token);
    expect([...url.searchParams.keys()]).toEqual(['token']);
    expect(url.pathname).toBe('/reset');
    expect(message.html).toContain('href="');
    for (const body of [message.text, message.html]) {
      expect(body).toContain('30 minutes');
      expect(body).toContain('ignore this email');
      expect(body).not.toContain(input.email);
    }
  });

  it('times out at 8 seconds and handles a late SDK rejection', async () => {
    jest.useFakeTimers();
    try {
      let rejectSend!: (error: Error) => void;
      send.mockReturnValue(new Promise((_resolve, reject) => { rejectSend = reject; }));
      const result = adapter.sendPasswordReset(input);
      const rejected = expect(result).rejects.toThrow('Password reset email delivery failed');
      await jest.advanceTimersByTimeAsync(7999);
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      await rejected;
      expect(jest.getTimerCount()).toBe(0);
      rejectSend(new Error('late provider failure'));
      await jest.advanceTimersByTimeAsync(0);
    } finally { jest.useRealTimers(); }
  });

  it.each(['success', 'returned error', 'exception', 'synchronous exception'])(
    'clears timers after %s', async (scenario) => {
      jest.useFakeTimers();
      try {
        if (scenario === 'returned error') send.mockResolvedValue({ data: null, error: {} });
        if (scenario === 'exception') send.mockRejectedValue(new Error('provider failure'));
        if (scenario === 'synchronous exception') send.mockImplementation(() => { throw new Error('provider failure'); });
        const result = adapter.sendPasswordReset(input);
        if (scenario === 'success') await expect(result).resolves.toBeUndefined();
        else await expect(result).rejects.toThrow('Password reset email delivery failed');
        expect(jest.getTimerCount()).toBe(0);
      } finally { jest.useRealTimers(); }
    },
  );

  it('preserves configured query parameters and escapes the HTML attribute', async () => {
    adapter = new ResendPasswordResetDelivery({ from, resetUrl: 'https://example.invalid/reset?lang=en&token=old' }, { emails: { send } });
    await adapter.sendPasswordReset(input);
    const message = send.mock.calls[0][0];
    const textLink = message.text.match(/https:\/\/\S+/)[0];
    const htmlLink = message.html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&');
    expect(htmlLink).toBe(textLink);
    const url = new URL(htmlLink);
    expect(url.searchParams.getAll('token')).toEqual([input.token]);
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.has('email')).toBe(false);
    expect(url.searchParams.has('userId')).toBe(false);
    expect(message.html).toContain('&amp;token=');
  });

  it('rejects a resolved Resend error with a safe error', async () => {
    send.mockResolvedValue({ data: null, error: { message: `sensitive-key ${input.token}` } });
    const result = adapter.sendPasswordReset(input);
    await expect(result).rejects.toThrow('Password reset email delivery failed');
    await expect(result).rejects.toMatchObject({ message: 'Password reset email delivery failed' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('replaces SDK exceptions without retaining sensitive messages or causes', async () => {
    send.mockRejectedValue(new Error(`sensitive-key ${input.token}`));
    const error = await adapter.sendPasswordReset(input).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Password reset email delivery failed');
    expect(error.cause).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('AuthModule password reset delivery selection', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:1/test', JWT_SECRET: 'test-only',
    STRIPE_SECRET_KEY: 'sk_test_unused', STRIPE_WEBHOOK_SECRET: 'whsec_unused',
    NODE_ENV: 'test',
  };
  const send = jest.fn();
  beforeEach(() => {
    jest.mocked(Resend).mockReset().mockImplementation(() => ({ emails: { send } }) as unknown as Resend);
    send.mockReset();
  });

  it.each([
    ['production', false, 1], ['development', false, 0], ['test', false, 0], ['production', true, 0],
  ])('warns only for disabled production delivery (%s, %s)', async (NODE_ENV, enabled, warnings) => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => {});
    try {
      const delivery = await passwordResetDeliveryProvider.useFactory(new ConfigService({
        NODE_ENV, PASSWORD_RESET_EMAIL_ENABLED: enabled, RESEND_API_KEY: 'mock-client-only',
        PASSWORD_RESET_FROM: 'reset@example.invalid', PASSWORD_RESET_URL: 'https://example.invalid/reset',
      }));
      expect(delivery).toBeInstanceOf(enabled ? ResendPasswordResetDelivery : NoopPasswordResetDelivery);
      expect(warn).toHaveBeenCalledTimes(Number(warnings));
      if (warnings) expect(warn).toHaveBeenCalledWith('Password reset emails will not be sent: email delivery is disabled.');
    } finally { warn.mockRestore(); }
  });

  it.each([undefined, 'false'])('starts without an API key and selects no-op (%s)', async (enabled) => {
    const config = validateEnvironment({ ...base, PASSWORD_RESET_EMAIL_ENABLED: enabled });
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(ConfigService).useValue(new ConfigService(config))
      .overrideProvider(AuthService).useValue({})
      .overrideProvider(JwtStrategy).useValue({})
      .compile();
    try {
      const delivery = module.get(PASSWORD_RESET_DELIVERY);
      expect(delivery).toBeInstanceOf(NoopPasswordResetDelivery);
      await delivery.sendPasswordReset({ email: 'test@example.invalid', token: 'synthetic', expiresAt: new Date() });
      expect(Resend).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });

  it('selects Resend only with the explicit enabled flag and complete configuration', async () => {
    const config = validateEnvironment({ ...base, PASSWORD_RESET_EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 'mock-client-only', PASSWORD_RESET_FROM: 'reset@example.invalid',
      PASSWORD_RESET_URL: 'https://example.invalid/reset',
    });
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(ConfigService).useValue(new ConfigService(config))
      .overrideProvider(AuthService).useValue({})
      .overrideProvider(JwtStrategy).useValue({})
      .compile();
    try {
      expect(module.get(PASSWORD_RESET_DELIVERY)).toBeInstanceOf(ResendPasswordResetDelivery);
      expect(Resend).toHaveBeenCalledWith('mock-client-only');
      expect(send).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });
});
