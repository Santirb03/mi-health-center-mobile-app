export const stripePublishableKey =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
// This release is explicitly for test checkout. Never initialize with secret or live keys.
export const stripeTestConfigured = /^pk_test_\S+$/.test(stripePublishableKey);
