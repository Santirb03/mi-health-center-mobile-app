const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText,
    filename,
  );
const calendar = require("../src/services/calendar.ts");
const booking = require("../src/services/booking.ts");
const {
  weekStart,
  weekDates,
  calendarRange,
  reservationDay,
  groupByDay,
  dayShortLabel,
  dayNumber,
  dayLongLabel,
  weekRangeLabel,
  defaultSelectedDate,
} = calendar;
const week = weekDates("2026-10-05");
const reservation = (
  id,
  startTime = "2026-10-05T14:00:00Z",
  endTime = "2026-10-05T15:00:00Z",
) => ({
  id,
  roomId: "room",
  startTime,
  endTime,
  status: "CONFIRMED",
  expiresAt: null,
  totalPrice: "500",
  room: { id: "room", name: "Consultorio 1" },
});
const midnightCrossing = reservation(
  "crossing",
  "2026-10-05T05:00:00Z",
  "2026-10-05T07:00:00Z",
);

test("weekStart keeps Monday", () =>
  assert.equal(weekStart("2026-10-05"), "2026-10-05"));
test("weekStart moves Wednesday to Monday", () =>
  assert.equal(weekStart("2026-10-07"), "2026-10-05"));
test("Sunday belongs to the Monday six days earlier", () =>
  assert.equal(weekStart("2026-10-11"), "2026-10-05"));
test("weekStart crosses the month boundary", () =>
  assert.equal(weekStart("2026-10-01"), "2026-09-28"));
test("weekStart crosses the year boundary", () =>
  assert.equal(weekStart("2027-01-01"), "2026-12-28"));
test("weekDates contains seven consecutive dates including a month change", () => {
  assert.deepEqual(weekDates("2026-09-28"), [
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
  ]);
});
test("weekDates crosses New Year", () => {
  assert.deepEqual(weekDates("2026-12-28"), [
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
});
test("calendarRange requests only Monday through Sunday", () => {
  assert.deepEqual(calendarRange("2026-10-05"), {
    from: "2026-10-05",
    to: "2026-10-11",
  });
});
test("reservationDay maps 02:00 UTC to the preceding business date", () => {
  assert.equal(reservationDay("2026-10-06T02:00:00Z"), "2026-10-05");
});
test("business dates, grouping and labels are independent of the device timezone", (t) => {
  const previous = process.env.TZ;
  const localHours = new Set();
  try {
    for (const zone of ["UTC", "Asia/Tokyo", "Pacific/Honolulu"]) {
      process.env.TZ = zone;
      localHours.add(new Date("2026-10-06T02:00:00Z").getHours());
      assert.equal(reservationDay("2026-10-06T02:00:00Z"), "2026-10-05");
      assert.equal(weekStart("2027-01-01"), "2026-12-28");
      assert.equal(dayLongLabel("2026-10-05"), "lunes 5 de octubre");
      assert.equal(
        groupByDay([midnightCrossing], week)["2026-10-05"].length,
        1,
      );
    }
    if (localHours.size < 3)
      t.skip("This runtime does not reliably apply process.env.TZ");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test("groupByDay includes every requested date", () =>
  assert.deepEqual(Object.keys(groupByDay([], week)), week));
test("empty dates have empty arrays", () => {
  const groups = groupByDay([reservation("one")], week);
  for (const date of week.slice(1)) assert.deepEqual(groups[date], []);
});
test("groupByDay orders reservations by their actual startTime", () => {
  const earlier = reservation(
    "early",
    "2026-10-05T14:00:00Z",
    "2026-10-05T15:00:00Z",
  );
  const later = reservation(
    "late",
    "2026-10-05T16:00:00Z",
    "2026-10-05T17:00:00Z",
  );
  const items = [later, earlier];
  assert.deepEqual(groupByDay(items, week)[week[0]], [earlier, later]);
  assert.deepEqual(items, [later, earlier]);
});
test("groupByDay breaks tied startTimes by id", () => {
  assert.deepEqual(
    groupByDay([reservation("b"), reservation("a")], week)[week[0]].map(
      (item) => item.id,
    ),
    ["a", "b"],
  );
});
test("groupByDay ignores reservations outside the supplied dates", () => {
  const groups = groupByDay(
    [
      reservation("before", "2026-10-04T14:00:00Z", "2026-10-04T15:00:00Z"),
      reservation("after", "2026-10-12T14:00:00Z", "2026-10-12T15:00:00Z"),
    ],
    week,
  );
  assert.ok(Object.values(groups).every((items) => items.length === 0));
});
test("20:00 local is grouped into the correct business day", () => {
  const item = reservation(
    "evening",
    "2026-10-06T02:00:00Z",
    "2026-10-06T03:00:00Z",
  );
  const groups = groupByDay([item], week);
  assert.deepEqual(groups["2026-10-05"], [item]);
  assert.deepEqual(groups["2026-10-06"], []);
});
test("Sunday 23:00 to Monday 01:00 appears in both overlapping days", () => {
  const groups = groupByDay([midnightCrossing], ["2026-10-04", "2026-10-05"]);
  assert.deepEqual(groups["2026-10-04"], [midnightCrossing]);
  assert.deepEqual(groups["2026-10-05"], [midnightCrossing]);
});
test("a reservation starting in the previous week still appears on Monday", () => {
  const groups = groupByDay([midnightCrossing], week);
  assert.deepEqual(groups[week[0]], [midnightCrossing]);
  assert.ok(
    Object.values(groups)
      .slice(1)
      .every((items) => items.length === 0),
  );
});
test("exclusive midnight end never creates a reservation on the next day", () => {
  const item = reservation(
    "midnight",
    "2026-10-06T04:00:00Z",
    "2026-10-06T06:00:00Z",
  );
  const groups = groupByDay([item], week);
  assert.deepEqual(groups["2026-10-05"], [item]);
  assert.deepEqual(groups["2026-10-06"], []);
});
test("duplicate ids and duplicate dates do not duplicate a reservation within a day", () => {
  const groups = groupByDay(
    [midnightCrossing, midnightCrossing],
    ["2026-10-04", "2026-10-05", "2026-10-05"],
  );
  assert.equal(groups["2026-10-04"].length, 1);
  assert.equal(groups["2026-10-05"].length, 1);
});
test("dayShortLabel uses Spanish weekday tables", () => {
  assert.deepEqual(week.map(dayShortLabel), [
    "lun",
    "mar",
    "mié",
    "jue",
    "vie",
    "sáb",
    "dom",
  ]);
});
test("dayNumber returns the day without leading zero", () =>
  assert.equal(dayNumber("2026-10-05"), 5));
test("dayLongLabel uses Spanish weekday and month tables", () => {
  assert.equal(dayLongLabel("2026-10-05"), "lunes 5 de octubre");
  assert.equal(dayLongLabel("2027-01-03"), "domingo 3 de enero");
});
test("weekRangeLabel handles a week in the same month", () =>
  assert.equal(weekRangeLabel("2026-10-05"), "5 – 11 de octubre de 2026"));
test("weekRangeLabel handles two months", () =>
  assert.equal(
    weekRangeLabel("2026-09-28"),
    "28 de septiembre – 4 de octubre de 2026",
  ));
test("weekRangeLabel shows both years across New Year", () =>
  assert.equal(
    weekRangeLabel("2026-12-28"),
    "28 de diciembre de 2026 – 3 de enero de 2027",
  ));
test("defaultSelectedDate selects today when it belongs to the week including Sunday", () => {
  for (const date of week)
    assert.equal(defaultSelectedDate(week[0], date), date);
});
test("defaultSelectedDate selects Monday when today is outside the week", () => {
  assert.equal(defaultSelectedDate(week[0], "2026-10-04"), week[0]);
  assert.equal(defaultSelectedDate(week[0], "2026-10-12"), week[0]);
});

function loadWithStubs(filename, stubs) {
  const module = { exports: {} };
  const source = ts.transpileModule(
    fs.readFileSync(require.resolve(filename), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require(name) {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
}

test("getCalendar uses the weekly endpoint, params and the exact AbortSignal", async () => {
  const signal = new AbortController().signal;
  const data = { items: [reservation("one")], truncated: true };
  const calls = [];
  const { getCalendar } = loadWithStubs("../src/services/reservations.ts", {
    "./api": {
      api: {
        get: async (...args) => {
          calls.push(args);
          return { data };
        },
      },
    },
  });
  assert.equal(await getCalendar(week[0], week[6], signal), data);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/reservations/calendar");
  assert.equal(calls[0][1].params.from, week[0]);
  assert.equal(calls[0][1].params.to, week[6]);
  assert.equal(calls[0][1].signal, signal);
});
test("getCalendar propagates network errors for useResource retry", async () => {
  const failure = new Error("offline");
  const { getCalendar } = loadWithStubs("../src/services/reservations.ts", {
    "./api": {
      api: {
        get: async () => {
          throw failure;
        },
      },
    },
  });
  await assert.rejects(
    getCalendar(week[0], week[6], new AbortController().signal),
    (error) => error === failure,
  );
});

// Exercise the real screen's read callback with injected hooks, without claiming native rendering.
function screenFixture(getUser) {
  const reads = [];
  let read;
  let state = {
    data: null,
    loading: true,
    error: null,
    reload: async () => {},
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const Redirect = () => {};
  const screen = loadWithStubs("../src/app/calendar.tsx", {
    react: {
      useState: (value) => [
        typeof value === "function" ? value() : value,
        () => {},
      ],
      useCallback: (value) => value,
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "expo-router": { Redirect, router: { push: () => {} } },
    "react-native": { Pressable: "Pressable", Text: "Text", View: "View" },
    "../components/booking-ui": {
      Page: "Page",
      Action: "Action",
      LoadState: "LoadState",
      styles: {},
    },
    "../hooks/use-resource": {
      useResource: (callback) => {
        read = callback;
        return state;
      },
    },
    "../hooks/use-now": { useNow: () => Date.parse("2026-10-07T18:00:00Z") },
    "../services/admin-agenda": { getCurrentUser: getUser },
    "../services/booking": {
      ...booking,
      businessDate: (now) =>
        booking.businessDate(now ?? new Date("2026-10-07T18:00:00Z")),
    },
    "../services/calendar": calendar,
    "../services/reservations": {
      getCalendar: async (...args) => {
        reads.push(args);
        return { items: [], truncated: false };
      },
    },
  });
  const element = screen.default();
  const render = () => element.type(element.props);
  render();
  return {
    read,
    reads,
    Redirect,
    render,
    setData(data) {
      state = { ...state, data, loading: false };
    },
  };
}
test("administrator links never read the calendar and redirect to home", async () => {
  const f = screenFixture(async () => ({ role: "ADMIN" }));
  const data = await f.read(new AbortController().signal);
  assert.equal(data.calendar, null);
  assert.equal(f.reads.length, 0);
  f.setData(data);
  const redirect = f.render();
  assert.equal(redirect.type, f.Redirect);
  assert.equal(redirect.props.href, "/home");
});
test("doctor profile is verified before the single weekly read with its AbortSignal", async () => {
  const controller = new AbortController();
  let resolveUser;
  const f = screenFixture((signal) => {
    assert.equal(signal, controller.signal);
    return new Promise((resolve) => {
      resolveUser = resolve;
    });
  });
  const pending = f.read(controller.signal);
  assert.equal(f.reads.length, 0);
  resolveUser({ role: "DOCTOR" });
  await pending;
  assert.equal(f.reads.length, 1);
  assert.deepEqual(f.reads[0], ["2026-10-05", "2026-10-11", controller.signal]);
});
test("a cancelled profile read cannot start a stale calendar request", async () => {
  const controller = new AbortController();
  let resolveUser;
  const f = screenFixture(
    () =>
      new Promise((resolve) => {
        resolveUser = resolve;
      }),
  );
  const pending = f.read(controller.signal);
  controller.abort();
  resolveUser({ role: "DOCTOR" });
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.reads.length, 0);
});
