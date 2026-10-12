function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
// Observed with Prisma 7.9.1 + PrismaPg: P2039 / meta.driverAdapterError.cause / 23P01.
export function isExclusionViolation(error: unknown): boolean {
  const root = record(error);
  const cause = record(record(record(root.meta).driverAdapterError).cause);
  return root.code === '23P01' || cause.originalCode === '23P01' || cause.code === '23P01';
}
