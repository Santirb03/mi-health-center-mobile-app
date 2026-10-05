const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename,
);
const history = require("../src/services/payment-history.ts");
const booking = require("../src/services/booking.ts");
const calendar = require("../src/services/calendar.ts");
const { createPaymentHistoryPager, paymentStatusText, paymentDateLabel, reservationNote } = history;
const totals = { paid: "250.00", refunded: "30.00", net: "220.00" };
const item = (id, overrides = {}) => ({
  id, reservationId: `reservation-${id}`, amount: "150.10", status: "PAID",
  paidAt: "2026-10-06T02:00:00Z", createdAt: "2026-10-06T02:00:00Z",
  refunds: [], refundSync: null,
  reservation: { id: `reservation-${id}`, startTime: "2026-10-06T02:00:00Z",
    endTime: "2026-10-06T03:00:00Z", status: "CONFIRMED", room: { id: "room", name: "Consultorio 1" } },
  ...overrides,
});
const page = (items = [item("one")], nextCursor = "page-2", summary = totals) => ({ items, nextCursor, totals: summary });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function pendingPager() {
  const calls = [];
  const pager = createPaymentHistoryPager((cursor, signal) => {
    const pending = deferred(); calls.push({ cursor, signal, ...pending }); return pending.promise;
  });
  return { pager, calls };
}

test("first load captures items, cursor and global totals without a cursor", async () => {
  const f = pendingPager();
  const pending = f.pager.reload();
  assert.equal(f.calls[0].cursor, null);
  assert.equal(f.calls[0].signal.aborted, false);
  assert.deepEqual(f.pager.getSnapshot(), { items: [], nextCursor: null, totals: null, loading: true, error: null });
  f.calls[0].resolve(page()); await pending;
  assert.deepEqual(f.pager.getSnapshot(), { ...page(), loading: false, error: null });
});

test("more appends payments and preserves first-page totals when the next page returns null", async () => {
  const cursors = [];
  const pager = createPaymentHistoryPager(async cursor => {
    cursors.push(cursor);
    return cursor === null ? page() : page([item("two")], null, null);
  });
  await pager.reload(); await pager.more();
  assert.deepEqual(cursors, [null, "page-2"]);
  assert.deepEqual(pager.getSnapshot().items.map(row => row.id), ["one", "two"]);
  assert.deepEqual(pager.getSnapshot().totals, totals);
  assert.equal(pager.getSnapshot().nextCursor, null);
});

test("repeated more taps cannot create concurrent requests", async () => {
  const f = pendingPager(); const first = f.pager.reload();
  f.calls[0].resolve(page()); await first;
  const next = f.pager.more(); await f.pager.more(); await f.pager.more();
  assert.equal(f.calls.length, 2); assert.equal(f.pager.getSnapshot().loading, true);
  f.calls[1].resolve(page([item("two")], null, null)); await next;
});

test("reload cancels a pending page, clears the old list and totals, and discards its late success", async () => {
  const f = pendingPager(); const first = f.pager.reload(); f.calls[0].resolve(page()); await first;
  const oldPage = f.pager.more(); const refreshed = f.pager.reload();
  assert.equal(f.calls[1].signal.aborted, true);
  assert.equal(f.calls[2].cursor, null);
  assert.deepEqual(f.pager.getSnapshot(), { items: [], nextCursor: null, totals: null, loading: true, error: null });
  f.calls[2].resolve(page([item("fresh")], null, { paid: "1.00", refunded: "0.00", net: "1.00" })); await refreshed;
  const snapshot = f.pager.getSnapshot();
  f.calls[1].resolve(page([item("stale")], "stale-cursor", null)); await oldPage;
  assert.equal(f.pager.getSnapshot(), snapshot);
});

test("late rejection of an aborted request cannot overwrite a successful reload", async () => {
  const f = pendingPager(); const old = f.pager.reload(); const fresh = f.pager.reload();
  f.calls[1].resolve(page()); await fresh;
  const snapshot = f.pager.getSnapshot(); f.calls[0].reject(new Error("stale failure")); await old;
  assert.equal(f.pager.getSnapshot(), snapshot);
});

test("later-page failures preserve items, totals and cursor; only retry reads that cursor again", async () => {
  const f = pendingPager(); const first = f.pager.reload(); f.calls[0].resolve(page()); await first;
  const next = f.pager.more(); f.calls[1].reject(new Error("offline")); await next;
  const state = f.pager.getSnapshot();
  assert.deepEqual(state.items, [item("one")]); assert.deepEqual(state.totals, totals);
  assert.equal(state.nextCursor, "page-2"); assert.equal(state.loading, false);
  assert.equal(state.error, "No pudimos cargar tus pagos. Intenta de nuevo.");
  await f.pager.more(); assert.equal(f.calls.length, 2);
  const retry = f.pager.retry(); await f.pager.retry(); await f.pager.more();
  assert.equal(f.calls.length, 3); assert.equal(f.calls[2].cursor, "page-2");
  f.calls[2].resolve(page([item("two")], null, null)); await retry;
  assert.deepEqual(f.pager.getSnapshot().items.map(row => row.id), ["one", "two"]);
  assert.deepEqual(f.pager.getSnapshot().totals, totals); assert.equal(f.pager.getSnapshot().error, null);
});

test("first-page failure leaves an empty list and retry requests the first page", async () => {
  const f = pendingPager(); const first = f.pager.reload(); f.calls[0].reject(new Error("404")); await first;
  assert.deepEqual(f.pager.getSnapshot(), { items: [], totals: null, nextCursor: null, loading: false,
    error: "No pudimos cargar tus pagos. Intenta de nuevo." });
  const retry = f.pager.retry(); assert.equal(f.calls[1].cursor, null);
  assert.equal(f.pager.getSnapshot().error, null);
  f.calls[1].resolve(page()); await retry; assert.deepEqual(f.pager.getSnapshot().totals, totals);
});

test("deduplicates ids within and across pages while preserving first-appearance order", async () => {
  const pager = createPaymentHistoryPager(async cursor => cursor === null
    ? page([item("one"), item("two"), item("one")])
    : page([item("two", { amount: "99.90" }), item("three"), item("three"), item("four")], null, null));
  await pager.reload(); await pager.more();
  assert.deepEqual(pager.getSnapshot().items.map(row => row.id), ["one", "two", "three", "four"]);
  assert.equal(pager.getSnapshot().items[1].amount, "99.90");
});

test("dispose aborts the active request and ignores its late response", async () => {
  const f = pendingPager(); const pending = f.pager.reload(); const state = f.pager.getSnapshot();
  f.pager.dispose(); assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].resolve(page()); await pending; assert.equal(f.pager.getSnapshot(), state);
});

test("more without nextCursor makes no request", async () => {
  let calls = 0; const pager = createPaymentHistoryPager(async () => { calls++; return page([], null); });
  await pager.more(); assert.equal(calls, 0);
  await pager.reload(); await pager.more(); assert.equal(calls, 1);
});

test("subscribe emits changes and unsubscribe stops notifications", async () => {
  let changes = 0; const pager = createPaymentHistoryPager(async () => page());
  const unsubscribe = pager.subscribe(() => changes++);
  await pager.reload(); assert.equal(changes, 2); unsubscribe();
  await pager.reload(); assert.equal(changes, 2);
});

test("an aborted request finishing cannot remove the newer request's tap guard", async () => {
  const f = pendingPager(); const old = f.pager.reload(); const fresh = f.pager.reload();
  f.calls[0].resolve(page()); await old; await f.pager.more(); assert.equal(f.calls.length, 2);
  f.calls[1].resolve(page()); await fresh;
  const more = f.pager.more(); assert.equal(f.calls.length, 3);
  f.calls[2].resolve(page([], null, null)); await more;
});

test("PAID is labelled Pagado", () => assert.equal(paymentStatusText("PAID"), "Pagado"));
test("REFUNDED is labelled Reembolsado", () => assert.equal(paymentStatusText("REFUNDED"), "Reembolsado"));
test("CANCELLED notes only the reservation cancellation", () => assert.equal(reservationNote("CANCELLED"), "La reserva fue cancelada."));
test("EXPIRED notes only the reservation expiry", () => assert.equal(reservationNote("EXPIRED"), "La reserva venció."));
test("other reservation states have no additional note", () => {
  for (const status of ["PENDING", "CONFIRMED", "COMPLETED"]) assert.equal(reservationNote(status), null);
});
test("null paidAt has an explicit missing-date label", () => assert.equal(paymentDateLabel(null), "Fecha de pago no registrada"));
test("payment date reuses the existing business day and time helpers", () => {
  const date = "2026-10-05T18:30:00Z";
  assert.equal(paymentDateLabel(date), `${calendar.dayLongLabel(calendar.reservationDay(date))} · ${booking.formatTime(date)}`);
});
test("an early October 6 UTC payment is labelled lunes 5 de octubre in Mexico City", () => {
  const date = "2026-10-06T02:00:00Z";
  assert.equal(paymentDateLabel(date).split(" · ")[0], "lunes 5 de octubre");
  assert.equal(paymentDateLabel(date).split(" · ")[1], booking.formatTime(date));
});

function loadWithStubs(filename, stubs) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve(filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
}

test("getPaymentHistory calls the existing endpoint with cursor params and the same AbortSignal", async () => {
  const calls = []; const data = page(); const signal = new AbortController().signal;
  const { getPaymentHistory } = loadWithStubs("../src/services/payments.ts", {
    "./api": { api: { get: async (...args) => { calls.push(args); return { data }; } } },
  });
  assert.equal(await getPaymentHistory(null, signal), data);
  assert.equal(await getPaymentHistory("cursor+/", signal), data);
  assert.equal(calls[0][0], "/payments/history"); assert.deepEqual(Object.keys(calls[0][1].params), []);
  assert.equal(calls[1][1].params.cursor, "cursor+/");
  assert.equal(calls[0][1].signal, signal); assert.equal(calls[1][1].signal, signal);
});

test("getPaymentHistory propagates failures to the pager", async () => {
  const failure = new Error("offline");
  const { getPaymentHistory } = loadWithStubs("../src/services/payments.ts", {
    "./api": { api: { get: async () => { throw failure; } } },
  });
  await assert.rejects(getPaymentHistory(null, new AbortController().signal), error => error === failure);
});

test("hook refreshes on focus and foreground, disposes on blur and can reload when focused again", async () => {
  const calls = []; let focus, change, cleanup, removed = 0, pager, subscribed = false;
  const hook = loadWithStubs("../src/hooks/use-payment-history.ts", {
    react: {
      useMemo: factory => factory(), useCallback: value => value,
      useSyncExternalStore: (subscribe, snapshot) => { subscribed = typeof subscribe === "function"; return snapshot(); },
    },
    "react-native": { AppState: { addEventListener: (event, callback) => {
      assert.equal(event, "change"); change = callback; return { remove: () => removed++ };
    } } },
    "expo-router": { useFocusEffect: callback => { focus = callback; cleanup = callback(); } },
    "../services/payment-history": { createPaymentHistoryPager: read => { pager = createPaymentHistoryPager(read); return pager; } },
    "../services/payments": { getPaymentHistory: (cursor, signal) => {
      const pending = deferred(); calls.push({ cursor, signal, ...pending }); return pending.promise;
    } },
  });
  const resource = hook.usePaymentHistory(); assert.equal(subscribed, true); assert.equal(calls.length, 1);
  assert.equal(resource.reload, pager.reload); assert.equal(resource.more, pager.more); assert.equal(resource.retry, pager.retry);
  change("background"); assert.equal(calls.length, 1);
  change("active"); assert.equal(calls.length, 2); assert.equal(calls[0].signal.aborted, true);
  cleanup(); assert.equal(calls[1].signal.aborted, true); assert.equal(removed, 1);
  cleanup = focus(); assert.equal(calls.length, 3); assert.equal(calls[2].cursor, null);
  calls.forEach(call => call.resolve(page())); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(pager.getSnapshot().totals, totals); cleanup(); assert.equal(removed, 2);
});

const jsx = (type, props, key) => ({ type, props, key });
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
function screenFixture(state) {
  const calls = { reload: 0, more: 0, retry: 0, routes: [] };
  const resource = { state, reload: async () => calls.reload++, more: async () => calls.more++, retry: async () => calls.retry++ };
  const screen = loadWithStubs("../src/app/payments.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Text: "Text", View: "View", ActivityIndicator: "ActivityIndicator" },
    "expo-router": { router: { push: route => calls.routes.push(route) } },
    "../components/booking-ui": { Action: "Action", LoadState: "LoadState", Page: "Page", styles: { card: "card" } },
    "../components/refund-status": { RefundStatus: "RefundStatus" },
    "../hooks/use-payment-history": { usePaymentHistory: () => resource },
    "../services/booking": booking, "../services/calendar": calendar, "../services/payment-history": history,
  });
  return { calls, resource, render: () => screen.default() };
}
const state = (overrides = {}) => ({ ...page(), loading: false, error: null, ...overrides });
const action = (tree, title) => nodes(tree).find(node => node.type === "Action" && node.props.title === title);

test("screen keeps the global summary visible after more and passes each full item to RefundStatus", async () => {
  const paid = item("one", { paidAt: null, reservation: { ...item("one").reservation, status: "CANCELLED" } });
  const f = screenFixture(state({ items: [paid] })); let tree = f.render();
  assert.ok(text(tree).includes(`Pagado: ${booking.money(totals.paid)} MXN`));
  assert.ok(text(tree).includes(`Reembolsado: ${booking.money(totals.refunded)} MXN`));
  assert.ok(text(tree).includes(`Neto: ${booking.money(totals.net)} MXN`));
  assert.ok(text(tree).includes("Pago: Fecha de pago no registrada"));
  assert.ok(text(tree).includes("La reserva fue cancelada."));
  assert.equal(nodes(tree).find(node => node.type === "RefundStatus").props.payment, paid);
  action(tree, "Cargar más").props.onPress(); assert.equal(f.calls.more, 1);
  f.resource.state = state({ items: [paid, item("two")], nextCursor: null }); tree = f.render();
  assert.ok(text(tree).includes(`Neto: ${booking.money(totals.net)} MXN`));
  assert.equal(nodes(tree).filter(node => node.type === "RefundStatus").length, 2);
  action(tree, "Ver reserva").props.onPress();
  assert.equal(f.calls.routes[0].pathname, "/reservations/[id]");
  assert.equal(f.calls.routes[0].params.id, paid.reservationId);
});

test("screen shows business dates, reservation expiry notes and payment status without reconstructing refund data", () => {
  const paid = item("one", { status: "REFUNDED", reservation: { ...item("one").reservation, status: "EXPIRED" },
    refunds: [{ amount: 3000, status: "pending" }], refundSync: { automatic: true, lastCheckedAt: null, needsReview: false, lastError: null } });
  const tree = screenFixture(state({ items: [paid] })).render();
  assert.ok(text(tree).includes("lunes 5 de octubre")); assert.ok(text(tree).includes("Reembolsado"));
  assert.ok(text(tree).includes("La reserva venció."));
  assert.ok(text(tree).includes(`${booking.money(paid.amount)} MXN`));
  assert.equal(nodes(tree).find(node => node.type === "RefundStatus").props.payment, paid);
});

test("screen's initial loading, initial error retry and empty state are distinct", async () => {
  const f = screenFixture(state({ items: [], nextCursor: null, totals: null, loading: true }));
  let tree = f.render(); assert.equal(nodes(tree).find(node => node.type === "LoadState").props.loading, true);
  assert.equal(action(tree, "Cargando pagos…").props.disabled, true);
  assert.equal(text(tree).includes("Aún no tienes pagos registrados."), false);
  f.resource.state = state({ items: [], totals: null, nextCursor: null, error: "No pudimos cargar tus pagos. Intenta de nuevo." });
  tree = f.render(); const load = nodes(tree).find(node => node.type === "LoadState");
  assert.equal(load.props.error, f.resource.state.error); await load.props.reload(); assert.equal(f.calls.retry, 1);
  assert.equal(text(tree).includes("Aún no tienes pagos registrados."), false);
  f.resource.state = state({ items: [], nextCursor: null }); tree = f.render();
  assert.ok(text(tree).includes("Aún no tienes pagos registrados."));
  assert.ok(text(tree).includes("Resumen de pagos"));
});

test("later-page error stays inline, keeps payments and totals, and calls retry instead of more", () => {
  const f = screenFixture(state({ error: "No pudimos cargar tus pagos. Intenta de nuevo." })); const tree = f.render();
  assert.equal(nodes(tree).some(node => node.type === "LoadState"), false);
  assert.ok(text(tree).includes("Consultorio 1")); assert.ok(text(tree).includes("Resumen de pagos"));
  assert.equal(nodes(tree).find(node => node.type === "Text" && text(node) === f.resource.state.error).props.accessibilityRole, "alert");
  assert.equal(action(tree, "Cargar más"), undefined);
  action(tree, "Reintentar").props.onPress(); assert.equal(f.calls.retry, 1); assert.equal(f.calls.more, 0);
});

test("loading more disables actions, marks its indicator busy, and retains the summary", () => {
  const f = screenFixture(state({ loading: true })); const tree = f.render();
  assert.equal(action(tree, "Actualizar").props.disabled, true);
  assert.equal(action(tree, "Cargando…").props.disabled, true);
  assert.equal(nodes(tree).find(node => node.type === "ActivityIndicator").props.accessibilityState.busy, true);
  assert.ok(text(tree).includes("Resumen de pagos"));
});

test("manual refresh uses reload and the screen marks its title as a heading", () => {
  const f = screenFixture(state()); const tree = f.render(); action(tree, "Actualizar").props.onPress();
  assert.equal(f.calls.reload, 1);
  assert.equal(nodes(tree).find(node => node.type === "Text" && text(node) === "Mis pagos").props.accessibilityRole, "header");
});

test("normal navigation offers Mis pagos only to doctors", () => {
  let role = "DOCTOR"; const routes = [];
  const navigation = loadWithStubs("../src/components/reservation-navigation.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "expo-router": { router: { push: route => routes.push(route) } },
    "./notification-navigation": { NotificationNavigation: "NotificationNavigation" },
    "react-native": { Text: "Text", View: "View" },
    "../hooks/use-resource": { useResource: () => ({ data: { role }, loading: false, error: null }) },
    "../services/admin-agenda": { getCurrentUser: () => { throw new Error("Unexpected profile call in fixture"); } },
    "./booking-ui": { Action: "Action", LoadState: "LoadState" },
  });
  action(navigation.ReservationNavigation(), "Mis pagos").props.onPress(); assert.deepEqual(routes, ["/payments"]);
  role = "ADMIN"; const admin = navigation.ReservationNavigation();
  assert.equal(action(admin, "Mis pagos"), undefined); assert.ok(action(admin, "Agenda del administrador"));
  role = undefined; assert.equal(action(navigation.ReservationNavigation(), "Mis pagos"), undefined);
});
