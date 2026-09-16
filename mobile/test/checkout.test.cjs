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
  createCheckout,
  canPay,
  checkoutDelay,
} = require("../src/services/checkout.ts");
const now = Date.parse("2031-01-10T14:00:00Z");
const pending = {
  id: "r",
  status: "PENDING",
  expiresAt: new Date(now + 60000).toISOString(),
};
function setup(overrides = {}) {
  const calls = { read: 0, create: 0, initialize: 0, present: 0, phases: [] };
  const deps = {
    read: async () => {
      calls.read++;
      return calls.read === 1 ? pending : { ...pending, status: "CONFIRMED" };
    },
    createIntent: async () => {
      calls.create++;
      return {
        clientSecret: "test_secret",
        paymentIntentId: "pi_test",
        expiresAt: pending.expiresAt,
      };
    },
    initialize: async () => {
      calls.initialize++;
      return {};
    },
    present: async () => {
      calls.present++;
      return {};
    },
    current: () => true,
    now: () => now,
    sleep: async () => {},
    phase: (v) => calls.phases.push(v),
    ...overrides,
  };
  return {
    calls,
    deps,
    checkout: createCheckout(deps),
    signal: new AbortController().signal,
  };
}
test("only a server confirmation completes checkout", async () => {
  const f = setup();
  assert.equal(await f.checkout.run("r", f.signal), "confirmed");
  assert.deepEqual(f.calls.phases, ["preparing", "paying", "confirming"]);
  assert.equal(f.calls.read, 2);
});
test("double submission shares a single PaymentSheet and intent", async () => {
  const f = setup();
  const first = f.checkout.run("r", f.signal);
  const second = f.checkout.run("r", f.signal);
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(f.calls.create, 1);
  assert.equal(f.calls.present, 1);
});
test("missing webhook leaves a pending result after bounded polling", async () => {
  let reads = 0;
  const f = setup({
    read: async () => {
      reads++;
      return pending;
    },
  });
  assert.equal(await f.checkout.run("r", f.signal), "pending");
  assert.equal(reads, 13);
  assert.equal(f.calls.create, 1);
});
test("a delayed webhook can confirm after the local hold deadline", async () => {
  let time = now,
    reads = 0;
  const f = setup({
    now: () => time,
    read: async () => {
      reads++;
      if (reads === 2) {
        time = now + 120000;
        return pending;
      }
      return reads > 2 ? { ...pending, status: "CONFIRMED" } : pending;
    },
  });
  assert.equal(await f.checkout.run("r", f.signal), "confirmed");
});
test("expired holds never create or display a payment", async () => {
  const f = setup({
    read: async () => ({ ...pending, expiresAt: new Date(now).toISOString() }),
  });
  assert.equal(await f.checkout.run("r", f.signal), "expired");
  assert.equal(f.calls.create, 0);
  assert.equal(canPay({ ...pending, expiresAt: null }, now), false);
});
test("initialization cannot open a hold that expired while preparing", async () => {
  let time = now;
  const f = setup({
    now: () => time,
    initialize: async () => {
      time += 120000;
      return {};
    },
  });
  assert.equal(await f.checkout.run("r", f.signal), "expired");
  assert.equal(f.calls.present, 0);
});
test("cancelled sheet does not confirm or cancel the reservation", async () => {
  const f = setup({ present: async () => ({ error: { code: "Canceled" } }) });
  assert.equal(await f.checkout.run("r", f.signal), "cancelled");
  assert.equal(f.calls.read, 1);
});
test("Stripe error is not reported as successful payment", async () => {
  const f = setup({ present: async () => ({ error: { code: "Failed" } }) });
  assert.equal(await f.checkout.run("r", f.signal), "failed");
});
test("server cancellation after sheet completion is not confirmation", async () => {
  let reads = 0;
  const f = setup({
    read: async () =>
      ++reads === 1 ? pending : { ...pending, status: "CANCELLED" },
  });
  assert.equal(await f.checkout.run("r", f.signal), "unavailable");
});
test("logout during intent preparation prevents opening the sheet", async () => {
  let current = true;
  const f = setup({
    current: () => current,
    createIntent: async () => {
      current = false;
      return {
        clientSecret: "secret",
        paymentIntentId: "pi_test",
        expiresAt: pending.expiresAt,
      };
    },
  });
  await assert.rejects(f.checkout.run("r", f.signal), /no longer active/);
  assert.equal(f.calls.initialize, 0);
  assert.equal(f.calls.present, 0);
});
test("network failure during polling remains uncertain instead of paid", async () => {
  let reads = 0;
  const f = setup({
    read: async () => {
      if (++reads > 1) throw new Error("offline");
      return pending;
    },
  });
  assert.equal(await f.checkout.run("r", f.signal), "pending");
  assert.equal(reads, 13);
});
test("aborting an active polling delay terminates it immediately", async () => {
  const controller = new AbortController();
  const delayed = checkoutDelay(30000, controller.signal);
  controller.abort();
  await assert.rejects(delayed, /Aborted/);
});
