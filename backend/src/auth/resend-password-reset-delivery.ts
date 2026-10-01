import { ConfigService } from '@nestjs/config';
import type { FactoryProvider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PASSWORD_RESET_DELIVERY, NoopPasswordResetDelivery, PASSWORD_RESET_TTL_MINUTES } from './password-reset-delivery';
import type { PasswordResetDelivery } from './password-reset-delivery';

const RESEND_SEND_TIMEOUT_MS = 8_000;

interface EmailClient {
  emails: {
    send(input: { from: string; to: string; subject: string; html: string; text: string }): Promise<{ error: unknown }>;
  };
}

export class ResendPasswordResetDelivery implements PasswordResetDelivery {
  constructor(
    private readonly config: { from: string; resetUrl: string },
    private readonly client: EmailClient,
  ) {}

  async sendPasswordReset(input: Parameters<PasswordResetDelivery['sendPasswordReset']>[0]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const resetUrl = new URL(this.config.resetUrl);
      resetUrl.searchParams.set('token', input.token);
      const link = resetUrl.toString();
      const htmlLink = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Limits waiting, not the provider's HTTP operation; delivery may still happen later.
      // Promise.race attaches rejection handlers to the send even after the timeout wins.
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Delivery timed out')), RESEND_SEND_TIMEOUT_MS);
      });
      const result = await Promise.race([timeout, this.client.emails.send({
        from: this.config.from,
        to: input.email,
        subject: 'Reset your Mi Health Center password',
        text: `A password reset was requested for your Mi Health Center account.\n\nReset your password: ${link}\n\nThis link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
        html: `<p>A password reset was requested for your Mi Health Center account.</p><p><a href="${htmlLink}">Reset your password</a></p><p>This link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.</p>`,
      })]);
      if (result.error != null) throw new Error('Provider rejected delivery');
    } catch {
      // Never attach provider payloads/causes: they may contain a token or API key.
      throw new Error('Password reset email delivery failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

export const passwordResetDeliveryProvider: FactoryProvider<PasswordResetDelivery> = {
  provide: PASSWORD_RESET_DELIVERY,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    if (config.get<boolean>('PASSWORD_RESET_EMAIL_ENABLED') !== true) {
      if (config.get<string>('NODE_ENV') === 'production') {
        Logger.warn('Password reset emails will not be sent: email delivery is disabled.');
      }
      return new NoopPasswordResetDelivery();
    }
    return new ResendPasswordResetDelivery({
      from: config.getOrThrow<string>('PASSWORD_RESET_FROM'),
      resetUrl: config.getOrThrow<string>('PASSWORD_RESET_URL'),
    }, new Resend(config.getOrThrow<string>('RESEND_API_KEY')));
  },
};
