const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const dashboard = require("../src/services/dashboard.ts");
const booking = require("../src/services/booking.ts");
const calendar = require("../src/services/calendar.ts");
const { periodRange, shiftAnchor, periodLabel, daysInclusive, validateCustomRange, formatBp, cancellationRateBp, formatMinutes, overallUtilization, rankRooms } = dashboard;

for (const [name, kind, anchor, from, to] of [
  ["day", "day", "2026-10-07", "2026-10-07", "2026-10-07"],
  ["week Monday", "week", "2026-10-05", "2026-10-05", "2026-10-11"],
  ["week Sunday", "week", "2026-10-11", "2026-10-05", "2026-10-11"],
  ["week crosses month", "week", "2026-10-01", "2026-09-28", "2026-10-04"],
  ["week crosses year", "week", "2027-01-01", "2026-12-28", "2027-01-03"],
  ["31-day month", "month", "2026-10-15", "2026-10-01", "2026-10-31"],
  ["leap February", "month", "2028-02-15", "2028-02-01", "2028-02-29"],
  ["non-leap February", "month", "2026-02-15", "2026-02-01", "2026-02-28"],
  ["December", "month", "2026-12-31", "2026-12-01", "2026-12-31"],
]) test(`periodRange ${name}`, () => assert.deepEqual(periodRange(kind, anchor), { from, to }));
test("custom periodRange never invents dates", () => assert.throws(() => periodRange("custom", "2026-10-07")));
for (const [kind, anchor, delta, expected] of [
  ["day", "2026-10-07", 1, "2026-10-08"], ["day", "2026-10-07", -1, "2026-10-06"],
  ["week", "2026-10-07", 1, "2026-10-14"], ["week", "2026-10-07", -1, "2026-09-30"],
  ["month", "2026-01-15", -1, "2025-12-01"], ["month", "2026-12-15", 1, "2027-01-01"],
  ["month", "2026-01-31", 1, "2026-02-01"], ["custom", "2026-10-07", 1, "2026-10-07"],
]) test(`shiftAnchor ${kind} ${anchor} ${delta}`, () => assert.equal(shiftAnchor(kind, anchor, delta), expected));
test("periodLabel shows Hoy only for the current business date", () => {
  const today = booking.businessDate();
  assert.equal(periodLabel("day", today), "Hoy");
  const yesterday = booking.shiftDate(today, -1);
  assert.equal(periodLabel("day", yesterday), calendar.dayLongLabel(yesterday));
});
test("weekly label uses the existing Spanish range", () => assert.equal(periodLabel("week", "2026-10-07"), calendar.weekRangeLabel("2026-10-05")));
test("monthly label uses Spanish month and year", () => assert.equal(periodLabel("month", "2026-10-15"), "octubre de 2026"));
test("dates and labels do not depend on device timezone", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      process.env.TZ = timezone;
      assert.deepEqual(periodRange("week", "2027-01-01"), { from: "2026-12-28", to: "2027-01-03" });
      assert.equal(periodLabel("month", "2026-10-15"), "octubre de 2026");
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test("daysInclusive counts one day", () => assert.equal(daysInclusive("2026-10-01", "2026-10-01"), 1));
test("62 inclusive days are allowed", () => {
  assert.equal(daysInclusive("2026-10-01", "2026-12-01"), 62);
  assert.equal(validateCustomRange("2026-10-01", "2026-12-01"), null);
});
test("63 inclusive days are rejected", () => assert.equal(validateCustomRange("2026-10-01", "2026-12-02"), "El periodo máximo es de 62 días."));
test("reversed range has a specific error", () => assert.equal(validateCustomRange("2026-10-02", "2026-10-01"), "La fecha final no puede ser anterior a la inicial."));
test("invalid and missing dates are rejected instead of normalized", () => {
  for (const date of ["2026-02-30", "2026-13-01", "2026-1-01", "", "bad"]) {
    assert.equal(validateCustomRange(date, "2026-10-01"), "Selecciona fechas válidas.");
    assert.equal(validateCustomRange("2026-10-01", date), "Selecciona fechas válidas.");
    assert.throws(() => daysInclusive(date, "2026-10-01"));
  }
});
test("inclusive days cross New Year", () => assert.equal(daysInclusive("2026-12-31", "2027-01-01"), 2));
for (const [bp, expected] of [[null, "—"], [0, "0.0 %"], [625, "6.3 %"], [5000, "50.0 %"], [6250, "62.5 %"], [10000, "100.0 %"], [11250, "112.5 %"]]) {
  test(`formatBp ${bp}`, () => assert.equal(formatBp(bp), expected));
}
test("cancellation rate with no eligible reservations is unknown", () => assert.equal(cancellationRateBp({ confirmed: 0, completed: 0, cancelled: 0, pendingActive: 5, expired: 9 }), null));
test("one cancelled out of three is 3333 bp, ignoring pending and expired", () => assert.equal(cancellationRateBp({ confirmed: 1, completed: 1, cancelled: 1, pendingActive: 50, expired: 100 }), 3333));
for (const [minutes, expected] of [[0, "0 min"], [45, "45 min"], [120, "2 h"], [150, "2 h 30 min"]]) test(`formatMinutes ${minutes}`, () => assert.equal(formatMinutes(minutes), expected));
const room = (roomId, overrides = {}) => ({ roomId, name: roomId, active: true, bookedMinutes: 100, availableMinutes: 200, utilizationBp: 5000, paid: "150.10", net: "150.10", ...overrides });
test("overall utilization sums rooms with capacity", () => assert.deepEqual(overallUtilization([room("a"), room("b", { bookedMinutes: 50, availableMinutes: 100 })]), { bookedMinutes: 150, availableMinutes: 300, bp: 5000 }));
test("overall utilization excludes inactive booked minutes", () => assert.deepEqual(overallUtilization([room("a"), room("inactive", { active: false, bookedMinutes: 80, availableMinutes: 0, utilizationBp: null })]), { bookedMinutes: 100, availableMinutes: 200, bp: 5000 }));
test("overall utilization excludes rooms without capacity", () => assert.deepEqual(overallUtilization([room("a"), room("zero", { bookedMinutes: 80, availableMinutes: 0, utilizationBp: null })]), { bookedMinutes: 100, availableMinutes: 200, bp: 5000 }));
test("all rooms without capacity have unknown utilization", () => assert.deepEqual(overallUtilization([room("zero", { availableMinutes: 0 })]), { bookedMinutes: 0, availableMinutes: 0, bp: null }));
test("empty rooms have unknown utilization", () => assert.equal(overallUtilization([]).bp, null));
test("overall utilization above 100 percent is not clamped", () => assert.equal(overallUtilization([room("a", { bookedMinutes: 225 })]).bp, 11250));
test("ranking puts higher utilization first and null last", () => assert.deepEqual(rankRooms([room("null", { utilizationBp: null }), room("low"), room("high", { utilizationBp: 11250 })], "utilization").map(r => r.roomId), ["high", "low", "null"]));
test("ranking compares 99.90 and 150.10 numerically", () => assert.deepEqual(rankRooms([room("low", { net: "99.90" }), room("high")], "net").map(r => r.roomId), ["high", "low"]));
test("ranking compares 1000.00 and 999.99 exactly", () => assert.deepEqual(rankRooms([room("low", { net: "999.99" }), room("high", { net: "1000.00" })], "net").map(r => r.roomId), ["high", "low"]));
test("ranking retains cents beyond Number precision and handles negative net", () => {
  assert.deepEqual(rankRooms([room("low", { net: "900719925474100.00" }), room("high", { net: "900719925474100.01" }), room("negative", { net: "-0.01" })], "net").map(r => r.roomId), ["high", "low", "negative"]);
});
for (const by of ["net", "utilization"]) {
  test(`${by} ranking ties by name then roomId and does not mutate`, () => {
    const rooms = [room("c", { name: "B" }), room("b", { name: "A" }), room("a", { name: "A" })];
    const original = structuredClone(rooms);
    assert.deepEqual(rankRooms(rooms, by).map(r => r.roomId), ["a", "b", "c"]);
    assert.deepEqual(rooms, original);
  });
}

function load(filename, stubs) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, AbortController, require(name) {
    if (Object.hasOwn(stubs, name)) return stubs[name]; throw new Error(`Unexpected dependency ${name}`);
  } });
  return module.exports;
}
const jsx = (type, props, key) => ({ type, props, key });
const runtime = { jsx, jsxs: jsx, Fragment: "Fragment" };
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}
const button = (tree, type, title) => nodes(tree).find(node => node.type === type && node.props.title === title);
function stateHooks() {
  const slots = []; let index = 0;
  return { reset: () => { index = 0; }, react: { useCallback: value => value, useState(initial) {
    const at = index++; if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial;
    return [slots[at], value => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }];
  } } };
}
const payload = (overrides = {}) => ({ range: { from: "2026-10-05", to: "2026-10-11", days: 7 },
  reservations: { confirmed: 2, completed: 1, cancelled: 1, expired: 4, pendingActive: 5 },
  cancellations: { cancelled: 1, cancelledWithPayment: 1 }, revenue: { paid: "250.00", refunded: "30.00", net: "220.00" },
  rooms: [room("wide", { utilizationBp: 11250, bookedMinutes: 225 }), room("inactive", { active: false, availableMinutes: 0, utilizationBp: null })],
  generatedAt: "2026-10-07T18:35:00Z", ...overrides });
function screenFixture(role = "ADMIN") {
  const hooks = stateHooks(); const reads = []; const routes = []; let read, reloads = 0;
  let state = { data: null, loading: true, error: null, reload: async () => reloads++ };
  const getCurrentUser = () => {};
  const screen = load("../src/app/admin-dashboard.tsx", {
    react: hooks.react, "react/jsx-runtime": runtime, "expo-router": { router: { replace: route => routes.push(route) } },
    "react-native": { Text: "Text", View: "View" },
    "../components/booking-ui": { Page: "Page", Action: "Action", LoadState: "LoadState", styles: {} },
    "../components/admin-ui": { AdminNav: "AdminNav", Choice: "Choice", DateNavigator: "DateNavigator" },
    "../hooks/use-resource": { useResource(callback) {
      if (callback === getCurrentUser) return { ...state, data: role ? { role } : null };
      read = callback; return state;
    } },
    "../services/admin-agenda": { getCurrentUser, getDashboard: async (...args) => { reads.push(args); return payload(); } },
    "../services/booking": { ...booking, businessDate: () => "2026-10-07", money(value) {
      assert.equal(typeof value, "string", "Dashboard must pass original decimal strings to money()");
      return booking.money(value);
    } }, "../services/dashboard": dashboard,
  });
  return { reads, routes, get reloads() { return reloads; }, get read() { return read; },
    render() { hooks.reset(); const outer = screen.default(); return typeof outer.type === "function" ? outer.type(outer.props) : outer; },
    setState(next) { state = { ...state, ...next }; },
  };
}
test("HTTP client uses the existing dashboard endpoint, range params and same signal", async () => {
  const calls = []; const data = payload(); const signal = new AbortController().signal;
  const client = load("../src/services/admin-agenda.ts", { "./api": { api: { get: async (...args) => { calls.push(args); return { data }; } } } });
  assert.equal(await client.getDashboard("2026-10-01", "2026-10-02", signal), data);
  assert.equal(calls[0][0], "/admin/dashboard"); assert.equal(calls[0][1].params.from, "2026-10-01");
  assert.equal(calls[0][1].params.to, "2026-10-02"); assert.equal(calls[0][1].signal, signal);
});
test("HTTP failures propagate for useResource retry", async () => {
  const failure = new Error("offline");
  const client = load("../src/services/admin-agenda.ts", { "./api": { api: { get: async () => { throw failure; } } } });
  await assert.rejects(client.getDashboard("2026-10-01", "2026-10-02", new AbortController().signal), error => error === failure);
});
test("doctor and unresolved profile never mount dashboard or call its endpoint", () => {
  for (const role of ["DOCTOR", null]) {
    const f = screenFixture(role); const tree = f.render();
    assert.equal(f.read, undefined); assert.equal(f.reads.length, 0);
    if (role) assert.ok(text(tree).includes("Este resumen está disponible únicamente para administradores."));
    button(tree, "Action", "Volver al inicio").props.onPress(); assert.deepEqual(f.routes, ["/home"]);
  }
});
test("initial week request uses Monday/Sunday and the supplied AbortSignal", async () => {
  const f = screenFixture(); const tree = f.render(); const signal = new AbortController().signal;
  const result = await f.read(signal);
  assert.deepEqual(f.reads[0], ["2026-10-05", "2026-10-11", signal]);
  assert.equal(result.rangeKey, "2026-10-05|2026-10-11");
  assert.equal(nodes(tree).find(n => n.type === "AdminNav").props.current, "/admin-dashboard");
  assert.equal(button(tree, "Choice", "Semana").props.selected, true);
});
test("period changes update the range and never display the previous period's metrics", async () => {
  const f = screenFixture(); f.render(); const old = await f.read(new AbortController().signal);
  f.setState({ data: old, loading: false }); const previous = f.render(); assert.ok(text(previous).includes("Ingresos"));
  button(previous, "Action", "Periodo siguiente ›").props.onPress(); const next = f.render();
  assert.equal(text(next).includes("Ingresos"), false);
  await f.read(new AbortController().signal); assert.equal(f.reads[1][0], "2026-10-12");
  button(next, "Choice", "Mes").props.onPress(); f.render(); await f.read(new AbortController().signal);
  assert.equal(f.reads[2][0], "2026-10-01"); assert.equal(f.reads[2][1], "2026-10-31");
  button(f.render(), "Choice", "Día").props.onPress(); f.render(); await f.read(new AbortController().signal);
  assert.equal(f.reads[3][0], "2026-10-14"); assert.equal(f.reads[3][1], "2026-10-14");
});
test("custom controls start with 30 days and invalid ranges make no dashboard request", async () => {
  const f = screenFixture(); button(f.render(), "Choice", "Personalizado").props.onPress();
  let tree = f.render(); let controls = nodes(tree).filter(n => n.type === "DateNavigator");
  assert.equal(controls[0].props.date, "2026-09-08"); assert.equal(controls[1].props.date, "2026-10-07");
  assert.equal(button(tree, "Action", "Periodo siguiente ›"), undefined);
  controls[0].props.onChange("2026-10-08"); tree = f.render();
  assert.ok(nodes(tree).some(n => n.props.accessibilityRole === "alert" && text(n) === "La fecha final no puede ser anterior a la inicial."));
  await f.read(new AbortController().signal); assert.equal(f.reads.length, 0);
  assert.equal(button(tree, "Action", "Actualizar").props.disabled, true);
  controls[0].props.onChange("2026-08-01"); f.render(); await f.read(new AbortController().signal); assert.equal(f.reads.length, 0);
  controls[0].props.onChange(""); f.render(); await f.read(new AbortController().signal); assert.equal(f.reads.length, 0);
  controls[0].props.onChange("2026-10-01"); controls[1].props.onChange("2026-12-01"); f.render();
  await f.read(new AbortController().signal); assert.equal(f.reads.length, 1); assert.equal(f.reads[0][1], "2026-12-01");
});
test("cards use backend money strings, combine completed and confirmed, and preserve over-100 text", async () => {
  const f = screenFixture(); f.render(); const data = await f.read(new AbortController().signal);
  f.setState({ data, loading: false }); const tree = f.render(); const visible = text(tree);
  assert.ok(visible.includes("Confirmadas: 3")); assert.ok(visible.includes("Pendientes de pago: 5"));
  assert.ok(visible.includes("Canceladas: 1")); assert.ok(visible.includes("Vencidas: 4"));
  assert.ok(visible.includes("Tasa de cancelación: 25.0 %")); assert.ok(visible.includes("1 canceladas con pago registrado"));
  assert.ok(visible.includes(`Neto: ${booking.money("220.00")} MXN`)); assert.ok(visible.includes("112.5 %"));
  assert.ok(visible.includes("Inactivo")); assert.ok(visible.includes("Ocupación: —"));
  assert.ok(visible.includes(`Actualizado a las ${booking.formatTime(payload().generatedAt)}`));
  const bars = nodes(tree).filter(n => n.props.accessibilityElementsHidden);
  assert.equal(bars.length, 2); assert.equal(bars[0].props.importantForAccessibility, "no-hide-descendants");
  assert.equal(bars[0].props.children.props.style.width, "100%");
  assert.equal(nodes(tree).find(n => text(n) === "Resumen").props.accessibilityRole, "header");
  assert.equal(button(tree, "Choice", "Por ocupación").props.selected, true);
  button(tree, "Choice", "Por ingreso neto").props.onPress(); assert.equal(button(f.render(), "Choice", "Por ingreso neto").props.selected, true);
});
test("valid empty periods show zero money, unknown percentages and empty room text", async () => {
  const f = screenFixture(); f.render(); const current = await f.read(new AbortController().signal);
  f.setState({ loading: false, data: { ...current, dashboard: payload({ rooms: [], reservations: { confirmed: 0, completed: 0, cancelled: 0, expired: 0, pendingActive: 0 }, revenue: { paid: "0.00", refunded: "0.00", net: "0.00" } }) } });
  const visible = text(f.render()); assert.ok(visible.includes("No hay consultorios para mostrar."));
  assert.ok(visible.includes("Tasa de cancelación: —")); assert.ok(visible.includes(`Cobrado: ${booking.money("0.00")} MXN`));
  assert.ok(visible.includes("0 min de 0 min disponibles"));
});
test("refresh and errors reuse LoadState, with disabled refresh while loading", () => {
  const f = screenFixture(); const loading = f.render(); assert.equal(button(loading, "Action", "Actualizar").props.disabled, true);
  f.setState({ loading: false, error: "Sin conexión" }); const failed = f.render();
  const loadState = nodes(failed).find(n => n.type === "LoadState"); assert.equal(loadState.props.error, "Sin conexión");
  button(failed, "Action", "Actualizar").props.onPress(); assert.equal(f.reloads, 1);
  loadState.props.reload(); assert.equal(f.reloads, 2);
});
test("AdminHome and AdminNav both expose the single new Resumen entry", () => {
  const routes = [];
  const admin = load("../src/components/admin-ui.tsx", { react: { useState: value => [value, () => {}] }, "react/jsx-runtime": runtime,
    "react-native": { Text: "Text", View: "View", Pressable: "Pressable", Modal: "Modal", ScrollView: "ScrollView", StyleSheet: { create: value => value } },
    "expo-router": { router: { replace: route => routes.push(route) } }, "./booking-ui": { Action: "Action", styles: {} }, "../services/booking": booking });
  assert.equal(admin.adminSections.length, 4); assert.equal(admin.adminSections[3].route, "/admin-dashboard");
  const tab = nodes(admin.AdminNav({ current: "/admin-dashboard" })).find(n => text(n) === "Resumen");
  assert.equal(tab.props.accessibilityState.selected, true); tab.props.onPress(); assert.equal(routes[0], "/admin-dashboard");
  const home = load("../src/components/admin-home.tsx", { "react/jsx-runtime": runtime,
    "react-native": { Alert: {}, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "expo-router": { router: { push: route => routes.push(route) } },
    "../providers/session-provider": { useSession: () => ({ signOut: async () => {} }) }, "./admin-ui": admin, "./booking-ui": { Action: "Action", styles: {} } });
  const entry = nodes(home.AdminHome()).find(n => n.props.accessibilityLabel?.startsWith("Resumen.")); entry.props.onPress(); assert.equal(routes[1], "/admin-dashboard");
});

test("dashboard route is inside the authenticated Stack with existing admin screen options", () => {
  const Stack = Object.assign(() => {}, { Screen: "Screen", Protected: "Protected" });
  const layout = load("../src/app/_layout.tsx", {
    "react/jsx-runtime": runtime, "expo-router": { Stack, usePathname: () => "/admin-dashboard" },
    "react-native": { ActivityIndicator: "ActivityIndicator", Alert: {}, Button: "Button", Text: "Text", View: "View" },
    "../providers/session-provider": { SessionProvider: "SessionProvider", useSession: () => ({ authenticated: true, loading: false, error: null }) },
    "../providers/payment-provider": { PaymentProvider: "PaymentProvider" },
  });
  const root = layout.default(); const navigator = nodes(root).find(n => typeof n.type === "function");
  const tree = navigator.type(); const protectedTree = nodes(tree).find(n => n.type === "Protected" && n.props.guard === true);
  const routes = nodes(protectedTree).filter(n => n.type === "Screen");
  const dashboardRoute = routes.find(n => n.props.name === "admin-dashboard"); assert.ok(dashboardRoute);
  assert.deepEqual(dashboardRoute.props.options, routes.find(n => n.props.name === "admin-agenda").props.options);
});

test("real useResource aborts old-period reads and ignores their late success and failure", async () => {
  const hooks = stateHooks(); const ref = { current: null }; const pending = [];
  let focus, removed = 0;
  const hook = load("../src/hooks/use-resource.ts", {
    react: { ...hooks.react, useRef: () => ref },
    "react-native": { AppState: { addEventListener: () => ({ remove: () => removed++ }) } },
    "expo-router": { useFocusEffect: callback => { focus = callback; } },
    "../services/errors": { getErrorMessage: () => "Sin conexión" },
  });
  const read = key => signal => new Promise((resolve, reject) => pending.push({ key, signal, resolve, reject }));
  const firstRead = read("old"); const freshRead = read("fresh");
  const render = callback => { hooks.reset(); return hook.useResource(callback); };
  render(firstRead); const leaveOld = focus();
  leaveOld(); assert.equal(pending[0].signal.aborted, true);
  render(freshRead); const leaveFresh = focus();
  pending[0].resolve("obsolete"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(render(freshRead).data, null);
  pending[1].resolve("current"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(render(freshRead).data, "current");
  const late = render(freshRead).reload(); const latest = render(freshRead).reload();
  assert.equal(pending[2].signal.aborted, true); pending[2].reject(new Error("obsolete failure")); await late;
  pending[3].resolve("latest"); await latest;
  assert.equal(render(freshRead).data, "latest"); assert.equal(render(freshRead).error, null);
  leaveFresh(); assert.equal(removed, 2);
});
