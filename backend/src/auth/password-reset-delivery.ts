export const PASSWORD_RESET_DELIVERY = Symbol('PASSWORD_RESET_DELIVERY');

export interface PasswordResetDelivery {
  sendPasswordReset(input: {
    email: string;
    token: string;
    expiresAt: Date;
  }): Promise<void>;
}

// Phase 1 only: no email, persistence, or logging of the raw token.
export class NoopPasswordResetDelivery implements PasswordResetDelivery {
  async sendPasswordReset(_input: {
    email: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {}
}
