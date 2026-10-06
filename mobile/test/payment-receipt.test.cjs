const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const receipt = require('../src/services/payment-receipt.ts');
const { BUSINESS_RECEIPT } = require('../src/config/business.ts');
const booking = require('../src/services/booking.ts');
const calendar = require('../src/services/calendar.ts');
const history = require('../src/services/payment-history.ts');
const item = (overrides = {}) => ({ id: 'abcd1234-5678-9012', reservationId: 'reservation', amount: '150.10', status: 'PAID',
  paidAt: '2026-10-06T02:00:00Z', createdAt: '2026-10-06T02:00:00Z', refunds: [], refundSync: null,
  reservation: { id: 'reservation', startTime: '2026-10-06T02:00:00Z', endTime: '2026-10-06T03:00:00Z',
    status: 'CONFIRMED', room: { id: 'room', name: 'Consultorio odontológico con nombre largo' } }, ...overrides });
const build = overrides => receipt.buildPaymentReceipt(item(overrides), BUSINESS_RECEIPT);
const values = result => Object.fromEntries(result.lines.map(line => [line.label, line.value]));
const mxn = amount => `${booking.money(amount)} MXN`;

test('amountToCents parses decimal text exactly and rejects invalid or unsafe amounts', () => {
  for (const [text, expected] of [['450.00', 45000], ['450', 45000], ['450.5', 45050], ['0.10', 10], ['19.99', 1999], ['90071992547409.91', Number.MAX_SAFE_INTEGER]]) {
    assert.equal(receipt.amountToCents(text), expected);
  }
  for (const text of ['', 'abc', '1.234', '-5', ' 5', '5.', '90071992547409.92']) assert.throws(() => receipt.amountToCents(text));
});
test('centsToText formats integer cents without losing digits', () => {
  for (const [cents, expected] of [[0, '0.00'], [5, '0.05'], [12345, '123.45'], [-5, '-0.05'], [Number.MAX_SAFE_INTEGER, '90071992547409.91']]) assert.equal(receipt.centsToText(cents), expected);
  for (const cents of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => receipt.centsToText(cents));
});
test('succeededRefundCents counts only succeeded refunds', () => {
  const refunds = ['succeeded', 'pending', 'requires_action', 'failed', 'canceled', 'succeeded'].map(status => ({ status, amount: 600 }));
  assert.equal(receipt.succeededRefundCents(refunds), 1200);
  assert.throws(() => receipt.succeededRefundCents([{ status: 'succeeded', amount: 0.5 }]));
});
test('receipt without refunds has ordered fields, uppercase reference and Mexico City dates', () => {
  const result = build(); const fields = values(result);
  assert.deepEqual(result.lines.map(line => line.label), ['Referencia', 'Consultorio', 'Reserva', 'Fecha de pago', 'Monto pagado', 'Estado del pago']);
  assert.equal(fields.Referencia, 'ABCD1234');
  assert.equal(fields.Reserva, 'lunes 5 de octubre · 20:00–21:00');
  assert.equal(fields['Fecha de pago'], history.paymentDateLabel(item().paidAt));
  assert.equal(fields['Monto pagado'], mxn('150.10'));
  assert.equal(fields['Estado del pago'], 'Pagado');
  assert.deepEqual(result.business.details, []);
  assert.equal(result.text, [BUSINESS_RECEIPT.name, '', 'Comprobante de pago', ...result.lines.map(line => `${line.label}: ${line.value}`), '', 'Montos en pesos mexicanos (MXN).', BUSINESS_RECEIPT.legend].join('\n'));
  assert.ok(result.text.includes(item().reservation.room.name));
});
test('full and partial succeeded refunds reduce net in integer cents', () => {
  for (const [amount, net] of [[15010, '0.00'], [3000, '120.10']]) {
    const fields = values(build({ status: amount === 15010 ? 'REFUNDED' : 'PAID', refunds: [{ status: 'succeeded', amount }] }));
    assert.equal(fields.Neto, mxn(net)); assert.equal(fields.Reembolsado, mxn(receipt.centsToText(amount)));
    assert.equal(fields['Estado del pago'], amount === 15010 ? 'Reembolsado' : 'Pagado');
  }
});
test('pending refunds show their count and never reduce net; failed and canceled are ignored', () => {
  const fields = values(build({ refunds: [{ status: 'succeeded', amount: 3000 }, { status: 'pending', amount: 2000 }, { status: 'requires_action', amount: 1000 }, { status: 'failed', amount: 500 }, { status: 'canceled', amount: 500 }] }));
  assert.equal(fields['Devoluciones en proceso'], '2'); assert.equal(fields.Neto, mxn('120.10'));
  const pending = values(build({ refunds: [{ status: 'pending', amount: 1000 }] }));
  assert.equal(pending['Devoluciones en proceso'], '1'); assert.equal(pending.Reembolsado, undefined); assert.equal(pending.Neto, undefined);
  assert.deepEqual(build({ refunds: [{ status: 'failed', amount: 500 }, { status: 'canceled', amount: 500 }] }).lines, build().lines);
});
test('missing paidAt is explicit and only configured contacts appear in order', () => {
  assert.equal(values(build({ paidAt: null }))['Fecha de pago'], 'Fecha de pago no registrada');
  const business = { ...BUSINESS_RECEIPT, address: ' Dirección de prueba ', phone: '5550000000', email: 'prueba@example.invalid' };
  const result = receipt.buildPaymentReceipt(item(), business);
  assert.deepEqual(result.business.details, ['Dirección de prueba', business.phone, business.email]);
  assert.ok(result.text.startsWith(`${business.name}\nDirección de prueba\n${business.phone}\n${business.email}\n\n`));
  assert.deepEqual(receipt.buildPaymentReceipt(item(), { ...business, address: ' ', phone: '', email: '' }).business.details, []);
});

const jsx = (type, props, key) => ({ type, props, key });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function hooks() {
  const slots = []; let index = 0;
  return { reset: () => { index = 0; }, react: { useState(initial) {
    const at = index++; if (!(at in slots)) slots[at] = initial;
    return [slots[at], value => { slots[at] = value; }];
  } } };
}
function load(filename, stubs) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve(filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    if (Object.hasOwn(stubs, name)) return stubs[name]; throw new Error(`Unexpected dependency ${name}`);
  } });
  return module.exports;
}
const ui = { Action: 'Action', Page: 'Page', LoadState: 'LoadState', styles: {} };
const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
const native = { Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', View: 'View', ActivityIndicator: 'ActivityIndicator' };
const action = (tree, title) => nodes(tree).find(node => node.type === 'Action' && node.props.title === title);
const flush = () => new Promise(resolve => setImmediate(resolve));
function modalFixture(share) {
  const state = hooks(); const calls = []; let closed = 0;
  const { PaymentReceiptModal } = load('../src/components/payment-receipt-modal.tsx', {
    react: state.react, 'react/jsx-runtime': runtime, 'react-native': { ...native, Share: { share: args => { calls.push(args); return share(); } } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../config/business': { BUSINESS_RECEIPT },
    '../services/payment-receipt': receipt, './booking-ui': ui,
  });
  return { calls, get closed() { return closed; }, render() { state.reset(); return PaymentReceiptModal({ item: item(), onClose: () => closed++ }); } };
}
test('modal shares exactly the displayed receipt text and dismissal is not an error', async () => {
  const f = modalFixture(async () => ({ action: 'dismissedAction' }));
  const tree = f.render(); assert.equal(tree.props.animationType, 'slide'); assert.equal(tree.props.accessibilityViewIsModal, true);
  action(tree, 'Compartir').props.onPress(); await flush();
  assert.equal(f.calls[0].message, build().text);
  assert.equal(nodes(f.render()).some(node => node.props.accessibilityRole === 'alert'), false);
  tree.props.onRequestClose(); action(tree, 'Cerrar').props.onPress(); assert.equal(f.closed, 2);
  assert.ok(nodes(tree).some(node => node.props.accessibilityRole === 'header' && node.props.children === 'Comprobante de pago'));
});
test('modal shows generic share errors, clears them on retry and disables sharing while pending', async () => {
  let resolve; let fail = true;
  const f = modalFixture(() => fail ? Promise.reject(new Error('private OS details')) : new Promise(yes => { resolve = yes; }));
  action(f.render(), 'Compartir').props.onPress(); await flush();
  assert.equal(nodes(f.render()).find(node => node.props.accessibilityRole === 'alert').props.children, 'No pudimos abrir el menú para compartir.');
  fail = false; action(f.render(), 'Compartir').props.onPress();
  const pending = f.render(); assert.equal(action(pending, 'Abriendo compartir…').props.disabled, true);
  assert.equal(nodes(pending).some(node => node.props.accessibilityRole === 'alert'), false);
  resolve({ action: 'sharedAction' }); await flush(); assert.equal(action(f.render(), 'Compartir').props.disabled, false);
});
test('payments selects the already-loaded item and closes the receipt without another request', () => {
  const state = hooks(); const payment = item(); let requests = 0;
  const screen = load('../src/app/payments.tsx', {
    react: state.react, 'react/jsx-runtime': runtime, 'react-native': native, 'expo-router': { router: { push() {} } },
    '../components/booking-ui': ui, '../components/refund-status': { RefundStatus: 'RefundStatus' },
    '../components/payment-receipt-modal': { PaymentReceiptModal: 'PaymentReceiptModal' },
    '../hooks/use-payment-history': { usePaymentHistory: () => ({ state: { items: [payment], totals: null, loading: false, error: null, nextCursor: null }, reload: () => requests++, more: () => requests++, retry: () => requests++ }) },
    '../services/booking': booking, '../services/calendar': calendar, '../services/payment-history': history,
  });
  const render = () => { state.reset(); return screen.default(); };
  assert.equal(nodes(render()).some(node => node.type === 'PaymentReceiptModal'), false);
  const button = action(render(), 'Ver comprobante'); assert.equal(button.props.variant, 'secondary'); button.props.onPress();
  const modal = nodes(render()).find(node => node.type === 'PaymentReceiptModal'); assert.equal(modal.props.item, payment);
  modal.props.onClose(); assert.equal(nodes(render()).some(node => node.type === 'PaymentReceiptModal'), false); assert.equal(requests, 0);
});
