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
const { blockInput, blocksOnDate } = require("../src/services/block-form.ts");
const now = Date.parse("2031-01-10T13:00:00Z");
test("block hours use coworking time regardless of device timezone", () => {
  assert.deepEqual(blockInput("2031-01-10", "8", "21", " Maintenance ", now), {
    startTime: "2031-01-10T14:00:00.000Z",
    endTime: "2031-01-11T03:00:00.000Z",
    reason: "Maintenance",
  });
});
test("rejects past, fractional, reversed, outside business hours and impossible dates", () => {
  for (const [date, start, end] of [
    ["2031-02-29", "08", "09"],
    ["2031-01-09", "08", "09"],
    ["2031-01-10", "8.5", "09"],
    ["2031-01-10", "09", "08"],
    ["2031-01-10", "07", "09"],
    ["2031-01-10", "20", "22"],
  ]) {
    assert.throws(() => blockInput(date, start, end, "", now));
  }
  assert.throws(() => blockInput("2031-01-10", "08", "09", "", now + 3600000));
});
test("day filter includes crossing blocks and excludes adjacent endpoints", () => {
  const block = (id, startTime, endTime) => ({ id, startTime, endTime });
  const rows = [
    block("previous", "2031-01-09T06:00:00Z", "2031-01-10T06:00:00Z"),
    block("crossing", "2031-01-10T05:00:00Z", "2031-01-10T07:00:00Z"),
    block("next", "2031-01-11T06:00:00Z", "2031-01-11T07:00:00Z"),
  ];
  assert.deepEqual(
    blocksOnDate(rows, "2031-01-10").map((b) => b.id),
    ["crossing"],
  );
});
