const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
global.__DEV__ = true;
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { reminderPlan } = require('../src/services/reminder-plan.ts');
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
    './reservations': { getReservations: async () => items },
    './admin-agenda': { getCurrentUser: async () => ({ id: 'user', role: 'DOCTOR' }) },
    './api': { session: { getVersion: () => version, getTokens: () => active ? {} : null } },
    './reminder-plan': { reminderPlan },
  };
  const module = new Module(filename);
  module.require = name => { if (!(name in stubs)) throw new Error(name); return stubs[name]; };
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return { service: module.exports, scheduled, handler: () => handler, cancel: () => { items = []; }, logout: () => { active = false; version++; } };
}
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
