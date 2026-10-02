const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(post = async () => ({ data: {} })) {
  let now = 100000;
  const calls = [];
  const module = { exports: {} };
  class Clock extends Date { static now() { return now; } }
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/services/password-reset.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, Date: Clock,
    require(name) {
      if (name === './api') return { publicApi: { post: (...args) => { calls.push(args); return post(...args); } } };
      if (name === 'axios') return require('axios');
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { ...module.exports, calls, advance(ms) { now += ms; } };
}

test('recovery validates email without normalizing it and checks both password fields', () => {
  const f = fixture();
  assert.equal(f.emailError('Doctor@Example.com'), undefined);
  assert.ok(f.emailError(' doctor@example.com '));
  assert.ok(f.emailError('invalid'));
  assert.equal(Object.keys(f.resetErrors(' password ', ' password ')).length, 0);
  assert.ok(f.resetErrors('short', 'short').password);
  assert.ok(f.resetErrors('password123', 'other').confirmation);
});

test('link token accepts only one intact token, rejects missing/duplicate/malformed params', () => {
  const f = fixture();
  const token = 'a'.repeat(43);
  assert.equal(f.resetToken(token), token);
  for (const invalid of [undefined, '', [token], [token, token], 'short', 'a'.repeat(42) + ' ', '%20' + token]) {
    assert.equal(f.resetToken(invalid), null);
  }
});

test('forgot uses the public endpoint, exact email and a 60-second cooldown', async () => {
  const f = fixture();
  await f.requestPasswordReset('Doctor@Example.com');
  assert.equal(f.calls[0][0], '/auth/forgot-password');
  assert.equal(f.calls[0][1].email, 'Doctor@Example.com');
  assert.equal(Object.keys(f.calls[0][1]).join(','), 'email');
  assert.equal(f.resendSeconds('Doctor@Example.com'), 60);
  f.advance(59999);
  await f.requestPasswordReset('Doctor@Example.com');
  assert.equal(f.calls.length, 1);
  assert.equal(f.resendSeconds('Doctor@Example.com'), 1);
  f.advance(1);
  assert.equal(f.resendSeconds('Doctor@Example.com'), 0);
  await f.requestPasswordReset('Doctor@Example.com');
  assert.equal(f.calls.length, 2);
});

test('duplicate requests are suppressed while a request is pending', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const first = f.requestPasswordReset('doctor@example.com');
  await f.requestPasswordReset('doctor@example.com');
  assert.equal(f.calls.length, 1);
  finish({ data: {} });
  await first;
});

test('uncertain network results preserve the resend wait and do not retry automatically', async () => {
  const failure = new Error('network');
  const f = fixture(async () => { throw failure; });
  await assert.rejects(f.requestPasswordReset('doctor@example.com'), error => error === failure);
  assert.equal(f.resendSeconds('doctor@example.com'), 60);
  await f.requestPasswordReset('doctor@example.com');
  assert.equal(f.calls.length, 1);
  f.advance(61000);
  assert.equal(f.resendSeconds('doctor@example.com'), 0);
});

test('reset submits only token/password exactly and exposes no credentials in error messages', async () => {
  const f = fixture();
  await f.submitPasswordReset('a'.repeat(43), ' password ');
  assert.equal(f.calls[0][0], '/auth/reset-password');
  assert.equal(f.calls[0][1].password, ' password ');
  assert.equal(Object.keys(f.calls[0][1]).sort().join(','), 'password,token');
  const invalid = f.resetFailure({ isAxiosError: true, response: { status: 400, data: { token: 'secret' } } });
  assert.equal(invalid.invalidToken, true);
  assert.equal(invalid.message, f.INVALID_RESET_MESSAGE);
  const limited = f.resetFailure({ isAxiosError: true, response: { status: 429 } });
  assert.equal(limited.invalidToken, false);
  assert.match(limited.message, /minuto/);
  assert.equal(f.resetFailure(new Error('secret')).invalidToken, false);
  assert.ok(!f.resetFailure(new Error('secret')).message.includes('secret'));
});
