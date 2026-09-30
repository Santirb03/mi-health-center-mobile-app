const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
global.__DEV__ = true;
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { reminderPlan } = require('../src/services/reminder-plan.ts');
const { collectConfirmed } = require('../src/services/upcoming-reservations.ts');
const now = Date.parse('2035-01-01T12:00:00Z');
test('only confirmed reservations with a future one-hour reminder qualify', () => {
  const items = ['PENDING', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'CONFIRMED'].map(status => ({ id: status, status, startTime: '2035-01-01T14:00:00Z' }));
  items.push({ id: 'too-late', status: 'CONFIRMED', startTime: '2035-01-01T12:30:00Z' });
  assert.deepEqual(reminderPlan(items, now), [{ id: 'CONFIRMED', at: now + 3600000 }]);
});
test('caps native scheduling at nearest 50 reminders', () => {
  const items = Array.from({ length: 80 }, (_, i) => ({ id: String(i), status: 'CONFIRMED', startTime: new Date(now + (i + 2) * 3600000).toISOString() })).reverse();
  const plan = reminderPlan(items, now);
  assert.equal(plan.length, 50); assert.equal(plan[0].id, '0'); assert.equal(plan.at(-1).id, '49');
});

function nativeFixture() {
  const Module = require('node:module');
  const path = require('node:path');
  const filename = path.resolve(__dirname, '../src/services/reminders.native.ts');
  const scheduled = new Map();
  const preferences = new Map([['reminders-user', 'on']]);
  let version = 0;
  let active = true;
  let items = [{ id: 'reservation', status: 'CONFIRMED', startTime: new Date(Date.now() + 7200000).toISOString() }];
  let handler;
  let readPage;
  const reads = [];
  const notifications = {
    setNotificationHandler: value => { handler = value; },
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    cancelScheduledNotificationAsync: async id => { scheduled.delete(id); },
    dismissAllNotificationsAsync: async () => {},
    getPermissionsAsync: async () => ({ granted: true }),
    scheduleNotificationAsync: async value => { scheduled.set(value.identifier, value); },
    SchedulableTriggerInputTypes: { DATE: 'date' },
  };
  const stubs = {
    'expo-notifications': notifications,
    'expo-secure-store': { getItemAsync: async key => preferences.get(key), setItemAsync: async (key, value) => preferences.set(key, value) },
    'react-native': { Platform: { OS: 'ios' } },
    './reservations': {
      getReservations: async () => { throw new Error('Unbounded reservations read is forbidden'); },
      getReservationPage: async (group, cursor, signal) => {
        reads.push({ group, cursor, signal });
        return readPage ? readPage(cursor) : { items, nextCursor: null };
      },
    },
    './upcoming-reservations': { collectConfirmed },
    './admin-agenda': { getCurrentUser: async () => ({ id: 'user', role: 'DOCTOR' }) },
    './api': { session: { getVersion: () => version, getTokens: () => active ? {} : null } },
    './reminder-plan': { reminderPlan },
  };
  const module = new Module(filename);
  module.require = name => { if (!(name in stubs)) throw new Error(name); return stubs[name]; };
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return { service: module.exports, scheduled, reads, setRead: read => { readPage = read; }, handler: () => handler, cancel: () => { items = []; }, logout: () => { active = false; version++; } };
}

test('collectConfirmed follows pages and stops at 50 candidates', async () => {
  const calls = [];
  const result = await collectConfirmed(async cursor => {
    calls.push(cursor);
    const start = cursor === null ? 0 : Number(cursor);
    return { items: Array.from({ length: 20 }, (_, i) => ({ id: String(start + i) })), nextCursor: String(start + 20) };
  });
  assert.deepEqual(calls, [null, '20', '40']);
  assert.deepEqual(result.map(r => r.id), Array.from({ length: 50 }, (_, i) => String(i)));
});

test('collectConfirmed stops at the last page, including an empty page', async () => {
  let calls = 0;
  assert.deepEqual(await collectConfirmed(async () => { calls++; return { items: [], nextCursor: null }; }), []);
  assert.equal(calls, 1);
});

test('collectConfirmed propagates a second-page failure instead of returning partial data', async () => {
  const failure = new Error('offline');
  await assert.rejects(collectConfirmed(async cursor => {
    if (cursor) throw failure;
    return { items: [{ id: 'first' }], nextCursor: 'next' };
  }), error => error === failure);
});

test('collectConfirmed rejects repeated cursors and longer cursor cycles', async () => {
  for (const sequence of [['a', 'a'], ['a', 'b', 'a']]) {
    let calls = 0;
    await assert.rejects(collectConfirmed(async () => ({ items: [], nextCursor: sequence[calls++] })), /cursor did not advance/);
    assert.equal(calls, sequence.length);
  }
});

test('collectConfirmed counts unique IDs toward the limit and respects maxPages', async () => {
  let calls = 0;
  const result = await collectConfirmed(async () => {
    calls++;
    return { items: [{ id: 'same' }, { id: String(calls) }], nextCursor: String(calls) };
  }, 4);
  assert.deepEqual(result.map(r => r.id), ['same', '1', '2', '3']);
  assert.equal(calls, 3);
  calls = 0;
  const capped = await collectConfirmed(async () => ({ items: [{ id: String(++calls) }], nextCursor: String(calls) }));
  assert.equal(calls, 5);
  assert.equal(capped.length, 5);
});

test('native sync uses confirmed pages and never calls the unbounded endpoint', async () => {
  const f = nativeFixture();
  await f.service.syncReminders();
  assert.equal(f.scheduled.size, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].group, 'confirmed');
  assert.equal(f.reads[0].cursor, null);
  assert.ok(f.reads[0].signal instanceof AbortSignal);
});

test('native sync preserves scheduled reminders when a later page fails', async () => {
  const f = nativeFixture();
  await f.service.syncReminders();
  const previous = [...f.scheduled.entries()];
  const failure = new Error('second page unavailable');
  f.setRead(async cursor => {
    if (cursor) throw failure;
    return { items: [{ id: 'different', status: 'CONFIRMED', startTime: new Date(Date.now() + 7200000).toISOString() }], nextCursor: 'next' };
  });
  await assert.rejects(f.service.syncReminders(), error => error === failure);
  assert.deepEqual([...f.scheduled.entries()], previous);
  assert.equal(f.reads.at(-1).signal, f.reads.at(-2).signal);
});
test('native synchronization is silent, idempotent and removes cancelled reminders', async () => {
  const f = nativeFixture();
  await f.service.syncReminders(); await f.service.syncReminders();
  assert.equal(f.scheduled.size, 1);
  assert.equal([...f.scheduled.values()][0].content.sound, false);
  const behavior = await f.handler().handleNotification();
  assert.equal(behavior.shouldPlaySound, false);
  assert.equal(behavior.shouldShowBanner, false);
  f.cancel(); await f.service.syncReminders(); assert.equal(f.scheduled.size, 0);
});
test('logout clears scheduled notices and queued work cannot recreate them', async () => {
  const f = nativeFixture(); await f.service.syncReminders();
  const pending = f.service.syncReminders(); f.logout(); await pending;
  assert.equal(f.scheduled.size, 0);
});
test('development test schedules one silent notice and survives normal sync', async () => {
  const f = nativeFixture();
  const before = Date.now();
  await f.service.testReminder(); await f.service.testReminder();
  assert.equal(f.scheduled.size, 1);
  const notice = f.scheduled.get('mhc-reminder:test');
  assert.equal(notice.content.sound, false);
  assert.ok(notice.trigger.date.getTime() >= before + 15000);
  await f.service.syncReminders();
  assert.ok(f.scheduled.has('mhc-reminder:test'));
  await f.service.clearReminders(); assert.equal(f.scheduled.size, 0);
});
test('production blocks the development test', async () => {
  const f = nativeFixture(); global.__DEV__ = false;
  try { await assert.rejects(f.service.testReminder(), /solo en desarrollo/); assert.equal(f.scheduled.size, 0); }
  finally { global.__DEV__ = true; }
});
