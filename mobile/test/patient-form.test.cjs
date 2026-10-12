const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { patientErrors, patientPayload, patientPatch, formFromPatient, civilDate, formatCivilDate, serverFieldErrors } = require("../src/services/patient-form.ts");
const form = { firstName: "John", lastName: "Doe", phone: "", email: "", dateOfBirth: "" };
const patient = { id: "patient", ...form, phone: "4421234567", email: "John@Example.com",
  dateOfBirth: "1990-01-01T00:00:00.000Z", doctorId: "private-owner", createdAt: "", updatedAt: "" };
for (const field of ["firstName", "lastName"]) {
  for (const invalid of ["", " ", "a", "a".repeat(81)])
    test(`${field} rejects length ${invalid.length}`, () => assert.ok(patientErrors({ ...form, [field]: invalid }, "2026-10-11")[field]));
  for (const valid of [" ab ", "a".repeat(80)])
    test(`${field} accepts trimmed valid length ${valid.length}`, () => assert.equal(patientErrors({ ...form, [field]: valid }, "2026-10-11")[field], undefined));
}
for (const phone of ["4421234567", "+52 (442) 123-4567", "442 123-4567", "00524421234567", "524421234567", "4421234567ext123"])
  test(`accepts compatible phone ${phone}`, () => assert.equal(patientErrors({ ...form, phone }, "2026-10-11").phone, undefined));
for (const phone of ["abc", "123", "+14421234567", " ".repeat(41) + "4421234567"])
  test(`rejects invalid phone ${phone}`, () => assert.ok(patientErrors({ ...form, phone }, "2026-10-11").phone));
test("email is optional, trimmed, bounded and not lowercased", () => {
  assert.deepEqual(patientErrors({ ...form, email: " John@Example.com " }, "2026-10-11"), {});
  assert.equal(patientPayload({ ...form, email: " John@Example.com " }).email, "John@Example.com");
  for (const email of ["invalid", "a b@example.com", "a".repeat(255) + "@example.com"])
    assert.ok(patientErrors({ ...form, email }, "2026-10-11").email);
});
for (const dateOfBirth of ["2000-02-29", "1990-01-01", "1900-01-01", "2026-10-11"])
  test(`accepts date ${dateOfBirth}`, () => assert.equal(patientErrors({ ...form, dateOfBirth }, "2026-10-11").dateOfBirth, undefined));
for (const dateOfBirth of ["1990-02-29", "1900-02-29", "2025-02-30", "1899-12-31", "2026-10-12", "1990-01-01T00:00:00Z", "1990-13-01"])
  test(`rejects date ${dateOfBirth}`, () => assert.ok(patientErrors({ ...form, dateOfBirth }, "2026-10-11").dateOfBirth));
test("civil date converts confirmed midnight ISO as text and formats Spanish", () => {
  assert.equal(civilDate(patient.dateOfBirth), "1990-01-01");
  assert.equal(formatCivilDate(patient.dateOfBirth), "1 de enero de 1990");
  assert.equal(civilDate(null), "");
  for (const iso of ["1990-01-01", "1990-01-01T01:00:00.000Z", "2025-02-30T00:00:00.000Z", "invalid"])
    assert.equal(civilDate(iso), "");
  assert.equal(formatCivilDate(null), "Fecha no disponible");
});
test("civil dates stay unchanged in negative and positive local timezones", () => {
  const previous = process.env.TZ;
  try {
    const hours = [];
    for (const zone of ["America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      hours.push(new Date(patient.dateOfBirth).getHours());
      assert.equal(civilDate(patient.dateOfBirth), "1990-01-01");
      assert.equal(formatCivilDate(patient.dateOfBirth), "1 de enero de 1990");
      assert.equal(formFromPatient(patient).dateOfBirth, "1990-01-01");
    }
    assert.notEqual(hours[0], hours[1], "Runtime must actually apply TZ for this regression");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test("creation sends trimmed whitelisted fields and omits empty optionals", () => {
  assert.deepEqual(patientPayload({ ...form, firstName: " John ", lastName: " Doe ", phone: " ", doctorId: "never" }),
    { firstName: "John", lastName: "Doe" });
  assert.equal(patientPayload({ ...form, phone: "+52 (442) 123-4567" }).phone, "+524421234567");
});
test("patch sends only changed fields, preserving email case", () => {
  assert.deepEqual(patientPatch(patient, { ...formFromPatient(patient), firstName: " Jane " }), { firstName: "Jane" });
  assert.deepEqual(patientPatch(patient, { ...formFromPatient(patient), email: "john@example.com" }), { email: "john@example.com" });
});
for (const field of ["phone", "email", "dateOfBirth"])
  test(`patch clears ${field} with null`, () => assert.deepEqual(patientPatch(patient, { ...formFromPatient(patient), [field]: " " }), { [field]: null }));
test("unchanged trimmed/normalized fields return null and preserve birth date", () => {
  assert.equal(patientPatch(patient, formFromPatient(patient)), null);
  assert.equal(patientPatch(patient, { ...formFromPatient(patient), firstName: " John ", phone: "(442) 123-4567" }), null);
});
test("known server validation messages become safe errors for the corresponding fields", () => {
  const mapped = serverFieldErrors(["firstName must be longer than or equal to 2 characters", "lastName must be a string",
    "phone must be a valid phone number", "email must be an email", "dateOfBirth must be a real YYYY-MM-DD date from 1900 through today"]);
  assert.deepEqual(Object.keys(mapped.fields), ["firstName", "lastName", "phone", "email", "dateOfBirth"]);
  assert.equal(mapped.general, null);
});
test("unknown messages keep a general Spanish fallback without leaking server content", () => {
  const mapped = serverFieldErrors(["email must be an email", "unexpected private body"]);
  assert.ok(mapped.fields.email); assert.match(mapped.general, /No pudimos guardar/);
  assert.equal(mapped.general.includes("private"), false);
  assert.ok(serverFieldErrors(undefined).general); assert.ok(serverFieldErrors([]).general);
});

const vm = require("node:vm");
const jsx = (type, props, key) => ({ type, props, key });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function editorFixture(original = null) {
  const cells = [], writes = [], routes = [], effects = [];
  let index = 0, version = 0;
  const react = {
    useState: initial => {
      const i = index++;
      if (!cells[i]) cells[i] = { value: typeof initial === "function" ? initial() : initial };
      return [cells[i].value, value => { cells[i].value = typeof value === "function" ? value(cells[i].value) : value; }];
    },
    useRef: initial => { const i = index++; return cells[i] ?? (cells[i] = { current: initial }); },
    useEffect: callback => { const i = index++; if (!cells[i]) effects.push(() => { cells[i] = { cleanup: callback() }; }); },
  };
  const session = { getVersion: () => version, getTokens: () => ({}) };
  const stubs = {
    react, axios: { isAxiosError: failure => !!failure.isAxiosError },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "ios" }, Text: "Text", View: "View" },
    "expo-router": { router: { replace: route => routes.push(route) }, useLocalSearchParams: () => ({}) },
    "../../components/booking-ui": { Page: "Page", Action: "Action", LoadState: "LoadState", styles: {} },
    "../../components/auth-input": { AuthInput: "FormInput" },
    "../../hooks/use-patient-list": { usePatientIdentity: () => version },
    "../../services/api": { session }, "../../services/booking": { businessDate: () => "2026-10-11" },
    "../../services/errors": { getErrorMessage: () => "No pudimos guardar el paciente. Intenta de nuevo." },
    "../../services/patient-form": { formFromPatient, patientErrors, patientPatch, patientPayload, serverFieldErrors },
    "../../services/patients": Object.fromEntries(["createPatient", "updatePatient", "getPatient"].map(method => [method, (...args) => {
      const pending = deferred(); writes.push({ method, args, ...pending }); return pending.promise;
    }])),
  };
  const filename = require.resolve("../src/app/patients/form.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled + "\nexports.editorForTest = PatientEditor;", {
    module, exports: module.exports, require: name => { if (!(name in stubs)) throw new Error(name); return stubs[name]; },
  });
  const render = () => { index = 0; const tree = module.exports.editorForTest({ original, version: 0 });
    while (effects.length) effects.shift()(); return tree; };
  const change = (label, value) => nodes(render()).find(node => node.type === "FormInput" && node.props.accessibilityLabel === label).props.onChangeText(value);
  const save = () => nodes(render()).find(node => node.type === "Action" && ["Guardar paciente", "Guardando..."].includes(node.props.title));
  return { render, change, save, writes, routes, changeSession: () => version++,
    unmount: () => cells.forEach(cell => cell?.cleanup?.()) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test("creation blocks double submits and navigates with only the created ID", async () => {
  const f = editorFixture(); f.change("Nombre", " John "); f.change("Apellidos", " Doe ");
  const submit = f.save().props.onPress; submit(); submit();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].method, "createPatient");
  assert.equal(f.writes[0].args[0].firstName, "John"); assert.equal(f.save().props.disabled, true);
  f.writes[0].resolve(patient); await tick();
  assert.equal(f.routes[0].pathname, "/patients/[id]"); assert.deepEqual(Object.keys(f.routes[0].params), ["id"]);
  f.unmount();
});
test("editing disables unchanged forms and sends only the cleared optional field", async () => {
  const f = editorFixture(patient); assert.equal(f.save().props.disabled, true);
  f.change("Teléfono", ""); assert.equal(f.save().props.disabled, false); f.save().props.onPress();
  assert.equal(f.writes[0].method, "updatePatient"); assert.equal(f.writes[0].args[0], patient.id);
  assert.deepEqual(Object.keys(f.writes[0].args[1]), ["phone"]); assert.equal(f.writes[0].args[1].phone, null);
  f.writes[0].resolve({ ...patient, phone: null }); await tick(); f.unmount();
});
test("recoverable save failures preserve form and map known 400 messages to the right input", async () => {
  const f = editorFixture(); f.change("Nombre", "Jane"); f.change("Apellidos", "Doe"); f.change("Correo", "Jane@Example.com");
  f.save().props.onPress(); f.writes[0].reject({ isAxiosError: true, response: { status: 400, data: { message: ["email must be an email"] } } });
  await tick();
  const inputs = nodes(f.render()).filter(node => node.type === "FormInput");
  assert.equal(inputs.find(node => node.props.accessibilityLabel === "Correo").props.value, "Jane@Example.com");
  assert.match(inputs.find(node => node.props.accessibilityLabel === "Correo").props.error, /correo válido/);
  f.change("Correo", "invalid");
  assert.match(nodes(f.render()).find(node => node.type === "FormInput" && node.props.accessibilityLabel === "Correo").props.error, /correo válido/);
  f.change("Correo", "Jane@Example.com"); f.save().props.onPress();
  f.writes[1].reject(new Error("offline")); await tick();
  assert.equal(f.save().props.disabled, false);
  assert.equal(nodes(f.render()).find(node => node.type === "FormInput" && node.props.accessibilityLabel === "Nombre").props.value, "Jane");
  f.unmount();
});
test("404 disables further editing or writes", async () => {
  const f = editorFixture(patient); f.change("Nombre", "Jane"); f.save().props.onPress();
  f.writes[0].reject({ isAxiosError: true, response: { status: 404 } }); await tick();
  assert.equal(f.save().props.disabled, true); f.save().props.onPress(); assert.equal(f.writes.length, 1); f.unmount();
});
for (const action of ["changeSession", "unmount"])
  test(`old write completion cannot navigate after ${action}`, async () => {
    const f = editorFixture(); f.change("Nombre", "Jane"); f.change("Apellidos", "Doe"); f.save().props.onPress();
    f[action](); f.writes[0].resolve(patient); await tick(); assert.deepEqual(f.routes, []); f.unmount();
  });
test("a session change before submit prevents any write", () => {
  const f = editorFixture(patient); f.change("Nombre", "Jane"); f.changeSession(); f.save().props.onPress();
  assert.equal(f.writes.length, 0); f.unmount();
});
