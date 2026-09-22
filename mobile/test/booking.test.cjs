const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};
const {
  businessDate,
  shiftDate,
  selectedRange,
  selectBookingSlot,
  selectable,
  reservationLabel,
  matchingReservation,
  reservationGroups,
} = require("../src/services/booking.ts");
const now = Date.parse("2031-01-10T14:00:00Z");
const slots = [15, 16, 17].map((hour) => ({
  startDateTime: `2031-01-10T${hour}:00:00.000Z`,
  endDateTime: `2031-01-10T${hour + 1}:00:00.000Z`,
  available: true,
  blocked: false,
}));
const input = {
  roomId: "room",
  startTime: slots[0].startDateTime,
  endTime: slots[1].endDateTime,
};
const pending = {
  ...input,
  id: "reservation",
  status: "PENDING",
  expiresAt: "2031-01-10T14:08:00Z",
};

test('selecting across an occupied hour rejects the change instead of silently moving the start', () => {
  const blocked = slots.map((slot, index) => ({ ...slot, available: index !== 1 }));
  assert.equal(selectBookingSlot(blocked, 0, 2, now), null);
  assert.deepEqual(selectBookingSlot(blocked, -1, 2, now), { start: 2, end: 2 });
  assert.deepEqual(selectBookingSlot(slots, 0, 2, now), { start: 0, end: 2 });
  assert.deepEqual(selectBookingSlot(slots, 2, 0, now), { start: 0, end: 0 });
});

test('selection rejects unavailable, expired or missing slots at tap time', () => {
  assert.equal(selectBookingSlot(slots, -1, 0, Date.parse(slots[0].startDateTime)), null);
  assert.equal(selectBookingSlot(slots, 0, 2, Date.parse(slots[0].startDateTime)), null);
  assert.equal(selectBookingSlot(slots, -1, 99, now), null);
  assert.equal(selectBookingSlot([{ ...slots[0], blocked: true }], -1, 0, now), null);
});

const { createReservationPager } = require('../src/services/reservation-pager.ts');
test('pagination preserves data on failure, retries the same cursor and deduplicates IDs', async () => {
  const cursors = [];
  let fail = true;
  const pager = createReservationPager(async (group, cursor) => {
    if (group !== 'history') return { items: [], nextCursor: null };
    cursors.push(cursor);
    if (!cursor) return { items: [pending], nextCursor: 'next' };
    if (fail) { fail = false; throw new Error('offline'); }
    return { items: [pending, { ...pending, id: 'second' }], nextCursor: null };
  });
  await pager.reload();
  await pager.more('history');
  assert.equal(pager.getSnapshot().history.items.length, 1);
  assert.ok(pager.getSnapshot().history.error);
  await pager.more('history');
  await pager.more('history');
  assert.deepEqual(cursors, [null, 'next', 'next']);
  assert.equal(pager.getSnapshot().history.items.length, 2);
});

test('pagination ignores late results after refresh or leaving the screen and blocks duplicate taps', async () => {
  let finish;
  let calls = 0;
  const pager = createReservationPager(async (group, cursor) => {
    if (group !== 'history') return { items: [], nextCursor: null };
    calls++;
    if (cursor) return new Promise((resolve) => { finish = resolve; });
    return { items: [pending], nextCursor: 'next' };
  });
  await pager.reload();
  const stale = pager.more('history');
  await pager.more('history');
  assert.equal(calls, 2);
  await pager.reload();
  finish({ items: [{ ...pending, id: 'stale' }], nextCursor: null });
  await stale;
  assert.deepEqual(pager.getSnapshot().history.items.map((r) => r.id), [pending.id]);
  const disposed = pager.more('history');
  pager.dispose();
  finish({ items: [{ ...pending, id: 'disposed' }], nextCursor: null });
  await disposed;
  assert.deepEqual(pager.getSnapshot().history.items.map((r) => r.id), [pending.id]);
});

test("reservation groups prioritize expiring holds and upcoming confirmed bookings without mutating input", () => {
  const first = { ...pending, id: "first", expiresAt: "2031-01-10T14:01:00Z" };
  const later = { ...pending, id: "later", status: "CONFIRMED", startTime: slots[2].startDateTime };
  const ongoing = { ...pending, id: "ongoing", status: "CONFIRMED", startTime: "2031-01-10T13:00:00Z" };
  const items = [later, pending, ongoing, first];
  const before = structuredClone(items);
  const groups = reservationGroups(items, now);
  assert.deepEqual(groups.map((g) => g.items.map((r) => r.id)), [
    ["first", "reservation"], ["ongoing", "later"], [],
  ]);
  assert.deepEqual(items, before);
});

test("reservation history handles exact expiry and end boundaries without completing server states", () => {
  const items = [
    { ...pending, expiresAt: new Date(now).toISOString() },
    { ...pending, expiresAt: null },
    { ...pending, status: "CONFIRMED", endTime: new Date(now).toISOString() },
    ...["CANCELLED", "COMPLETED", "EXPIRED"].map((status) => ({ ...pending, status })),
  ];
  const groups = reservationGroups(items, now);
  assert.equal(groups[0].items.length, 0);
  assert.equal(groups[1].items.length, 0);
  assert.equal(groups[2].items.length, items.length);
  assert.equal(items[0].status, "PENDING");
  assert.equal(items[2].status, "CONFIRMED");
  assert.deepEqual(reservationGroups([], now).map((g) => g.items), [[], [], []]);
});

test("dates follow the coworking timezone across UTC midnight", () => {
  assert.equal(businessDate(new Date("2031-01-11T02:00:00Z")), "2031-01-10");
  assert.equal(businessDate(new Date("2031-01-11T06:00:00Z")), "2031-01-11");
  assert.equal(shiftDate("2032-02-28", 1), "2032-02-29");
  assert.equal(shiftDate("2031-12-31", 1), "2032-01-01");
});
test("selects contiguous hours and rejects ranges across unavailable slots", () => {
  assert.equal(selectedRange(slots, 0, 2, now).length, 3);
  assert.equal(
    selectedRange(
      slots.map((s, i) => ({ ...s, available: i !== 1 })),
      0,
      2,
      now,
    ).length,
    0,
  );
  assert.equal(selectedRange([slots[0], slots[2]], 0, 1, now).length, 0);
  assert.equal(selectedRange(slots, -1, 1, now).length, 0);
  assert.equal(selectedRange(slots, 2, 1, now).length, 0);
});
test("a selected hour stops being bookable exactly when it begins", () => {
  assert.equal(selectable(slots[0], Date.parse(slots[0].startDateTime)), false);
  assert.equal(
    selectedRange(slots, 0, 1, Date.parse(slots[0].startDateTime)).length,
    0,
  );
  assert.equal(selectable({ ...slots[0], blocked: true }, now), false);
});
test("pending holds expire for display without changing confirmed status", () => {
  assert.match(reservationLabel(pending, now), /Pendiente/);
  assert.match(
    reservationLabel(pending, Date.parse(pending.expiresAt)),
    /vencida/,
  );
  assert.match(
    reservationLabel({ ...pending, expiresAt: null }, now),
    /vencida/,
  );
  assert.equal(
    reservationLabel({ ...pending, status: "CONFIRMED" }, now + 99999999),
    "Confirmada",
  );
  assert.equal(pending.status, "PENDING");
});
test("reconciliation only accepts an active reservation for the exact room and interval", () => {
  assert.equal(matchingReservation([pending], input, now)?.id, pending.id);
  for (const patch of [
    { roomId: "other" },
    { status: "CANCELLED" },
    { expiresAt: null },
    { endTime: slots[2].endDateTime },
  ]) {
    assert.equal(
      matchingReservation([{ ...pending, ...patch }], input, now),
      undefined,
    );
  }
  assert.equal(
    matchingReservation([pending], input, Date.parse(pending.expiresAt)),
    undefined,
  );
  assert.equal(
    matchingReservation([{ ...pending, status: "CONFIRMED" }], input, now)?.id,
    pending.id,
  );
});
