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
  selectable,
  reservationLabel,
  matchingReservation,
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
