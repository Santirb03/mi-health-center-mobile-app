import { nextRefundDelayMs } from './refunds';

describe('nextRefundDelayMs', () => {
  const idle = { versionChanged: false, outstanding: false, review: false, automatic: false, fullyRefunded: false };
  it.each([
    ['version change wins over all other conditions', { versionChanged: true, outstanding: true, review: true, automatic: true }, 0],
    ['version change wakes idle work', { versionChanged: true }, 0],
    ['outstanding refund wins over review', { outstanding: true, review: true, automatic: true }, 60_000],
    ['outstanding refund without review', { outstanding: true }, 60_000],
    ['automatic incomplete refund without review', { automatic: true }, 900_000],
    ['human review with fully refunded payment', { review: true, fullyRefunded: true }, 86_400_000],
    ['terminal failed external refund', { review: true, automatic: false }, 86_400_000],
    ['automatic incomplete refund requiring review', { automatic: true, review: true }, 86_400_000],
    ['automatic refund already complete', { automatic: true, fullyRefunded: true }, 86_400_000],
    ['normal idle payment', {}, 86_400_000],
  ] as const)('%s', (_label, overrides, expected) => {
    expect(nextRefundDelayMs({ ...idle, ...overrides })).toBe(expected);
  });
});
