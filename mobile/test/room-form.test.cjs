const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
const { roomPayload } = require("../src/services/room-form.ts");
test("accepts decimal comma and preserves cents without passing unrelated fields", () => {
  assert.deepEqual(
    roomPayload({
      name: " Room ",
      description: " ",
      price: "250,50",
      active: true,
    }),
    { name: "Room", description: "", pricePerHour: 250.5 },
  );
});
test("rejects ambiguous, negative, zero, overflow and over-precise prices", () => {
  for (const price of [
    "",
    "-1",
    "0",
    "250.999",
    "1,000.50",
    "1e3",
    "100000000",
    "NaN",
  ])
    assert.throws(() => roomPayload({ name: "Room", description: "", price }));
  assert.throws(() =>
    roomPayload({ name: "  ", description: "", price: "250" }),
  );
});
