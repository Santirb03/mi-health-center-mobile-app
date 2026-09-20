const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
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
};
const {
  registrationError,
  registrationErrors,
  registrationPayload,
} = require("../src/services/registration.ts");
const form = {
  firstName: " Santiago ",
  lastName: " Prueba ",
  email: " test@example.com ",
  password: " password ",
  confirmPassword: " password ",
};
test("registration maps independent errors to their fields and clears corrected values", () => {
  const invalid = { ...form, firstName: '', email: 'bad', confirmPassword: 'different' };
  assert.deepEqual(Object.keys(registrationErrors(invalid)), ['firstName', 'email', 'confirmPassword']);
  assert.deepEqual(registrationErrors(form), {});
  assert.deepEqual(Object.keys(registrationErrors({ ...invalid, firstName: 'Ana' })), ['email', 'confirmPassword']);
});
test("registration strips non-registration fields and preserves the exact password", () => {
  assert.equal(registrationError(form), null);
  assert.deepEqual(
    registrationPayload({ ...form, role: "ADMIN", accessToken: "injected" }),
    {
      firstName: "Santiago",
      lastName: "Prueba",
      email: "test@example.com",
      password: " password ",
    },
  );
});
test("invalid and mismatching fields cannot pass registration validation", () => {
  for (const change of [
    { firstName: "  " },
    { lastName: "A" },
    { email: "bad" },
    { password: "short", confirmPassword: "short" },
    { confirmPassword: "different" },
  ]) {
    assert.ok(registrationError({ ...form, ...change }));
  }
});
