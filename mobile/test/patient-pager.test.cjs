const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { createPatientPager, normalizeQuery } = require("../src/services/patient-pager.ts");
const item = id => ({ id, firstName: "John", lastName: "Doe" });
const page = (ids = ["one"], nextCursor = "second") => ({ items: ids.map(item), nextCursor });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const calls = [];
  const pager = createPatientPager((q, cursor, signal) => {
    const pending = deferred(); calls.push({ q, cursor, signal, ...pending }); return pending.promise;
  });
  return { pager, calls };
}
for (const [text, expected] of [
  ["", { kind: "all" }], ["  ", { kind: "all" }], [" a ", { kind: "too_short" }],
  ["ab", { kind: "search", q: "ab" }], [" John   Doe ", { kind: "search", q: "John Doe" }],
  ["a".repeat(81), { kind: "too_long" }], ["a".repeat(100), { kind: "too_long" }],
  ["one two three four five", { kind: "too_many_terms" }],
  ["one two three four", { kind: "search", q: "one two three four" }],
]) test(`normalizes query ${JSON.stringify(text)}`, () => assert.deepEqual(normalizeQuery(text), expected));
test("first page requests no search/cursor and captures result", async () => {
  const f = fixture(); const pending = f.pager.setQuery("");
  assert.equal(f.calls[0].q, undefined); assert.equal(f.calls[0].cursor, null);
  f.calls[0].resolve(page()); await pending;
  assert.deepEqual(f.pager.getSnapshot().items, [item("one")]);
  assert.equal(f.pager.getSnapshot().loading, false);
});
test("more keeps backend order, query and cursor, deduplicating by ID", async () => {
  const f = fixture(); const first = f.pager.setQuery(" John   Doe ");
  f.calls[0].resolve(page(["one", "two"])); await first;
  const more = f.pager.more();
  assert.equal(f.calls[1].q, "John Doe"); assert.equal(f.calls[1].cursor, "second");
  f.calls[1].resolve(page(["two", "three"], null)); await more;
  assert.deepEqual(f.pager.getSnapshot().items.map(item => item.id), ["one", "two", "three"]);
  await f.pager.more(); assert.equal(f.calls.length, 2);
});
test("query changes abort pending work and never reuse its cursor", async () => {
  const f = fixture(); const first = f.pager.setQuery("John");
  f.calls[0].resolve(page()); await first;
  const more = f.pager.more();
  const next = f.pager.setQuery("Jane");
  assert.equal(f.calls[1].signal.aborted, true);
  assert.equal(f.calls[2].cursor, null);
  assert.equal(f.calls[2].q, "Jane");
  assert.deepEqual(f.pager.getSnapshot().items, []);
  f.calls[1].resolve(page(["old"], "old-cursor")); await more;
  assert.deepEqual(f.pager.getSnapshot().items, []);
  f.calls[2].resolve(page(["new"], null)); await next;
  assert.deepEqual(f.pager.getSnapshot().items, [item("new")]);
});
test("same normalized query does not request twice", async () => {
  const f = fixture(); const first = f.pager.setQuery("John Doe");
  await f.pager.setQuery("  John   Doe  "); assert.equal(f.calls.length, 1);
  f.calls[0].resolve(page()); await first;
  await f.pager.setQuery("John Doe"); assert.equal(f.calls.length, 1);
});
test("rapid more taps cannot duplicate an active page", async () => {
  const f = fixture(); const first = f.pager.reload(); f.calls[0].resolve(page()); await first;
  const more = f.pager.more(); await f.pager.more(); await f.pager.more();
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve(page(["two"], null)); await more;
});
test("initial error retries first page with the same query", async () => {
  const f = fixture(); const first = f.pager.setQuery("John"); f.calls[0].reject(new Error("offline")); await first;
  assert.ok(f.pager.getSnapshot().error);
  const retry = f.pager.retry(); assert.equal(f.calls[1].cursor, null); assert.equal(f.calls[1].q, "John");
  f.calls[1].resolve(page()); await retry; assert.equal(f.pager.getSnapshot().error, null);
});
test("later failure preserves results and retries exactly the failed cursor", async () => {
  const f = fixture(); const first = f.pager.setQuery("John"); f.calls[0].resolve(page()); await first;
  const more = f.pager.more(); f.calls[1].reject(new Error("offline")); await more;
  assert.deepEqual(f.pager.getSnapshot().items, [item("one")]);
  await f.pager.more(); assert.equal(f.calls.length, 2);
  const retry = f.pager.retry(); assert.equal(f.calls[2].cursor, "second"); assert.equal(f.calls[2].q, "John");
  f.calls[2].resolve(page(["two"], null)); await retry;
  assert.deepEqual(f.pager.getSnapshot().items.map(item => item.id), ["one", "two"]);
});
for (const invalid of ["a", "a".repeat(81), "a".repeat(100), "one two three four five"])
  test(`invalid query clears patients immediately: ${invalid.length}`, async () => {
    const f = fixture(); const first = f.pager.reload(); f.calls[0].resolve(page()); await first;
    await f.pager.setQuery(invalid);
    assert.deepEqual(f.pager.getSnapshot().items, []); assert.equal(f.pager.getSnapshot().nextCursor, null);
    assert.equal(f.calls.length, 1); assert.equal(f.pager.getSnapshot().loading, false);
    const valid = f.pager.setQuery("ab"); assert.equal(f.calls[1].cursor, null);
    f.calls[1].resolve(page(["new"], null)); await valid;
  });
test("reload cancels work, clears rows and requests current query from scratch", async () => {
  const f = fixture(); const first = f.pager.setQuery("John");
  const next = f.pager.reload(); assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.calls[1].q, "John"); assert.equal(f.calls[1].cursor, null);
  f.calls[0].reject(new Error("late failure")); await first;
  f.calls[1].resolve(page()); await next; assert.equal(f.pager.getSnapshot().error, null);
});
test("dispose cancels requests, clears private rows and prevents updates or new reads", async () => {
  const f = fixture(); const pending = f.pager.reload(); let notifications = 0;
  f.pager.subscribe(() => notifications++); f.pager.dispose(); const before = notifications;
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].resolve(page(["private"])); await pending;
  await f.pager.reload(); await f.pager.setQuery("Jane"); await f.pager.more();
  assert.equal(f.calls.length, 1); assert.equal(notifications, before);
  assert.deepEqual(f.pager.getSnapshot().items, []);
});

function loadWithStubs(relative, stubs, extras = {}) {
  const filename = require.resolve(relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, AbortController,
    require: name => { if (!(name in stubs)) throw new Error(`Unexpected import: ${name}`); return stubs[name]; }, ...extras }, { filename });
  return module.exports;
}
test("HTTP services use the existing client, pin session version and pass only ID/payload", async () => {
  const calls = []; const response = { data: page() };
  const api = Object.fromEntries(["get", "post", "patch"].map(method => [method, async (...args) => { calls.push([method, ...args]); return response; }]));
  const service = loadWithStubs("../src/services/patients.ts", { "./api": { api, session: { getVersion: () => 7 } } });
  const signal = new AbortController().signal;
  await service.getPatientPage(undefined, null, signal);
  assert.equal(calls[0][1], "/patients/page"); assert.equal(calls[0][2]._sessionVersion, 7);
  assert.equal(calls[0][2].signal, signal); assert.deepEqual(Object.keys(calls[0][2].params), []);
  await service.getPatientPage("John", "cursor", signal);
  assert.equal(calls[1][2].params.q, "John"); assert.equal(calls[1][2].params.cursor, "cursor");
  await service.getPatient("id/encoded", signal); assert.equal(calls[2][1], "/patients/id%2Fencoded");
  const payload = { firstName: "John", lastName: "Doe" };
  await service.createPatient(payload); await service.updatePatient("id", { phone: null });
  assert.equal(calls[3][2], payload); assert.equal(calls[4][2].phone, null);
  assert.equal(calls[3][3]._sessionVersion, 7); assert.equal(calls[4][3]._sessionVersion, 7);
});

function hookFixture() {
  let index = 0, result, now = 0, version = 0, tokens = {}, timerId = 0, active = true;
  const cells = [], effects = [], timers = new Map(), sessionListeners = new Set(), reads = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  function memo(factory, deps) { const i = index++; if (!cells[i] || !same(cells[i].deps, deps)) cells[i] = { deps, value: factory() }; return cells[i].value; }
  function effect(callback, deps, focus = false) {
    const i = index++; const prior = cells[i];
    if (!prior || !same(prior.deps, deps)) {
      effects.push(() => { prior?.cleanup?.(); cells[i] = { deps, callback, focus, cleanup: !focus || active ? callback() : undefined }; });
    }
  }
  const react = {
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useRef: value => memo(() => ({ current: value }), []),
    useState: initial => { const i = index++; if (!cells[i]) cells[i] = { value: typeof initial === "function" ? initial() : initial };
      return [cells[i].value, value => { cells[i].value = typeof value === "function" ? value(cells[i].value) : value; }]; },
    useEffect: effect,
    useSyncExternalStore: (_subscribe, snapshot) => { index++; return snapshot(); },
  };
  const session = { getVersion: () => version, getTokens: () => tokens,
    subscribe: listener => { sessionListeners.add(listener); return () => sessionListeners.delete(listener); } };
  const hook = loadWithStubs("../src/hooks/use-patient-list.ts", {
    react, "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
    "expo-router": { useFocusEffect: callback => effect(callback, [callback], true) },
    "../services/api": { session }, "../services/patient-pager": { createPatientPager },
    "../services/patients": { getPatientPage: (q, cursor, signal) => { const pending = deferred(); reads.push({ q, cursor, signal, ...pending }); return pending.promise; } },
  }, {
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const render = () => { index = 0; result = hook.usePatientList(); while (effects.length) effects.shift()(); return result; };
  return { render, reads, timers,
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
    changeIdentity() { version++; tokens = {}; sessionListeners.forEach(listener => listener()); return render(); },
    blur() { active = false; cells.filter(cell => cell?.focus).forEach(cell => { cell.cleanup?.(); cell.cleanup = undefined; }); },
    focus() { active = true; cells.filter(cell => cell?.focus).forEach(cell => { cell.cleanup = cell.callback(); }); },
    unmount() { cells.forEach(cell => cell?.cleanup?.()); },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test("hook debounces 350ms, cancels old reads, resets cursors and clears invalid searches immediately", async () => {
  const f = hookFixture(); f.render();
  f.render().setText("John"); assert.equal(f.reads[0].signal.aborted, true);
  f.reads[0].resolve(page(["stale-initial"])); await tick();
  assert.deepEqual(f.render().state.items, []); f.advance(349); assert.equal(f.reads.length, 1);
  f.render().setText("Jane"); f.advance(349); assert.equal(f.reads.length, 1);
  f.advance(1); assert.equal(f.reads.length, 2); assert.equal(f.reads[1].q, "Jane");
  assert.equal(f.reads[1].cursor, null);
  f.render().setText("a"); assert.equal(f.reads[1].signal.aborted, true);
  assert.deepEqual(f.render().state.items, []); assert.equal(f.timers.size, 0);
  f.reads[1].resolve(page(["stale"])); await tick(); assert.deepEqual(f.render().state.items, []);
  f.render().setText("John"); f.unmount(); f.advance(400); assert.equal(f.reads.length, 2);
});
test("hook preserves text on refocus and clears account data and pending timers on identity change", async () => {
  const f = hookFixture(); f.render(); f.render().setText("John"); f.advance(350);
  f.reads[1].resolve(page(["private"])); await tick();
  assert.equal(f.render().state.items.length, 1);
  f.blur(); f.focus(); assert.equal(f.reads[2].q, "John"); assert.equal(f.render().text, "John");
  f.render().setText("Jane"); const next = f.changeIdentity();
  assert.equal(next.text, ""); assert.deepEqual(next.state.items, []); assert.equal(f.timers.size, 0);
  assert.equal(f.reads[2].signal.aborted, true);
  f.reads[2].resolve(page(["late-private"])); await tick(); assert.deepEqual(f.render().state.items, []);
  f.unmount();
});
