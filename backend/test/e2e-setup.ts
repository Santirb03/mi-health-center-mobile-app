// Runs before importing AppModule, so unsafe direct Jest invocations fail
// before any application configuration or database connection is loaded.
if (
  process.env.E2E_INTEGRATION_ISOLATED !== '1' ||
  new URL(process.env.DATABASE_URL ?? 'http://invalid').pathname !==
    '/mhc_payment_test' ||
  process.env.STRIPE_SECRET_KEY !== 'sk_test_isolated_unused'
) {
  throw new Error(
    'Use npm run test:e2e: disposable database and fake credentials required',
  );
}

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const Stripe = actual.default ?? actual;
  const { randomUUID } = require('node:crypto');
  return class TestStripe extends Stripe {
    constructor(...args: any[]) {
      super(...args);
      const intents = new Map<string, unknown>();
      this.paymentIntents.create = jest.fn(async (params: any) => {
        const id = `pi_${randomUUID()}`;
        const intent = {
          ...params,
          id,
          client_secret: `${id}_secret_test`,
          status: 'requires_payment_method',
        };
        intents.set(id, intent);
        return intent;
      });
      this.paymentIntents.retrieve = jest.fn(async (id: string) => {
        if (!intents.has(id)) throw new Error('Unknown mocked intent');
        return intents.get(id);
      });
      this.refunds.create = jest.fn(async () => ({
        id: `re_${randomUUID()}`,
        status: 'succeeded',
      }));
      // Fail closed if new code tries any unmocked Stripe API operation.
      this._requestSender._request = () => {
        throw new Error('Stripe network calls are forbidden in E2E');
      };
    }
  };
});
