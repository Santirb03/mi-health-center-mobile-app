const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { businessDate } = require("../src/services/booking.ts");
const { appointmentInstant } = require("../src/services/appointment-form.ts");
const { appointmentLabels, calendarMessage, truncationMessage, roomDescription, roomWarning, appointmentActions,
  appointmentFailure, createAppointmentPager, confirmedReservationsForDay, cancelMessage } = require("../src/services/appointment-schedule.ts");
const item = { id: "a", status: "SCHEDULED", startTime: "2030-01-01T16:00:00.000Z", endTime: "2030-01-01T16:30:00.000Z",
  patient: { id: "p", firstName: "Fixture", lastName: "Patient" }, reservation: null, needsRoomReview: true };
const p1 = "00000000-0000-4000-8000-000000000001", p2 = "00000000-0000-4000-8000-000000000002";
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
test("business day is UTC-6 across midnight boundaries", () => {
  assert.equal(businessDate(new Date("2030-01-02T05:59:59Z")), "2030-01-01");
  assert.equal(businessDate(new Date("2030-01-02T06:00:00Z")), "2030-01-02");
});
test("status labels distinguish all three states", () => assert.deepEqual(appointmentLabels,
  { SCHEDULED: "Programada", COMPLETED: "Completada", CANCELLED: "Cancelada" }));
test("room review uses backend flag and does not invent historical room", () => {
  assert.equal(roomDescription(item), "Sin reserva vinculada"); assert.match(roomWarning(item), /Revisa/);
  assert.equal(roomWarning({ ...item, needsRoomReview: false }), null);
  assert.equal(roomDescription({ ...item, reservation: { room: { name: "Sala fixture" } } }), "Sala fixture");
});
test("truncation is explicit even for an empty truncated calendar", () => {
  assert.equal(calendarMessage({ items: [], truncated: true }, false, null), truncationMessage);
});
test("empty calendar is shown only after successful completed load", () => {
  assert.equal(calendarMessage({ items: [], truncated: false }, false, null), "No tienes citas para este día.");
  assert.equal(calendarMessage(null, false, "offline"), null);
  assert.equal(calendarMessage({ items: [], truncated: false }, true, null), null);
  assert.equal(calendarMessage({ items: [], truncated: false }, false, "offline"), null);
  assert.equal(calendarMessage({ items: [item], truncated: false }, false, null), null);
});
test("completion begins exactly at start; rescheduling ends at start", () => {
  const start = Date.parse(item.startTime);
  assert.deepEqual(appointmentActions(item, start-1), { cancel: true, reschedule: true, complete: false });
  assert.deepEqual(appointmentActions(item, start), { cancel: true, reschedule: false, complete: true });
  for (const status of ["COMPLETED", "CANCELLED"])
    assert.deepEqual(appointmentActions({ ...item, status }, start), { cancel: false, reschedule: false, complete: false });
});
test("404 and conflicts are safe, specific and never echo SQL", () => {
  assert.equal(appointmentFailure(404, "private"), "Esta cita ya no está disponible.");
  assert.match(appointmentFailure(409, "Appointment overlaps another appointment"), /superpone/);
  assert.match(appointmentFailure(409, "Reservation must be confirmed"), /reserva/i);
  assert.equal(appointmentFailure(409, "SELECT private_patient FROM internal" ).includes("SELECT"), false);
  assert.equal(appointmentFailure(500, "private"), null);
});
test("cancel confirmation explicitly leaves reservation and refunds separate", () => assert.equal(cancelMessage,
  "Cancelar esta cita no cancela la reserva del consultorio ni genera un reembolso."));
test("history first page, backend order, deduplication and correct next cursor", async () => {
  const calls = [];
  const pager = createAppointmentPager(async (patient, cursor) => {
    calls.push([patient,cursor]);
    return cursor ? { items: [{ ...item, status: "CANCELLED" }, { ...item, id: "b" }], nextCursor: null }
      : { items: [item], nextCursor: "opaque-cursor" };
  });
  await pager.reload(); assert.deepEqual(calls, [[undefined,null]]);
  await pager.more(); assert.deepEqual(calls[1], [undefined,"opaque-cursor"]);
  assert.deepEqual(pager.getSnapshot().items.map(x => x.id), ["a","b"]);
  assert.equal(pager.getSnapshot().items[0].status, "CANCELLED");
  assert.equal(pager.getSnapshot().nextCursor, null);
});
test("changing patient clears items/cursor synchronously and starts from null", async () => {
  const requests=[];
  const pager=createAppointmentPager((patient,cursor,signal) => { const d=deferred(); requests.push({patient,cursor,signal,...d}); return d.promise; });
  const first=pager.setPatient(p1); requests[0].resolve({items:[item],nextCursor:"old"}); await first;
  const second=pager.setPatient(p2);
  assert.equal(pager.getSnapshot().items.length,0); assert.equal(pager.getSnapshot().nextCursor,null);
  assert.equal(requests[1].patient,p2); assert.equal(requests[1].cursor,null);
  requests[1].resolve({items:[],nextCursor:null}); await second;
});
test("later failure retains items and retry uses the same failed cursor", async () => {
  const calls=[]; let fail=true;
  const pager=createAppointmentPager(async (patient,cursor) => {
    calls.push([patient,cursor]); if (cursor && fail) throw new Error("offline");
    return {items:cursor ? [{...item,id:"b"}] : [item],nextCursor:cursor ? null : "next"};
  });
  await pager.setPatient(p1); await pager.more();
  assert.equal(pager.getSnapshot().items[0].id,"a"); assert.equal(pager.getSnapshot().nextCursor,"next");
  assert.match(pager.getSnapshot().error,/historial/); fail=false; await pager.retry();
  assert.deepEqual(calls,[[p1,null],[p1,"next"],[p1,"next"]]); assert.equal(pager.getSnapshot().items.length,2);
});
test("late response after patient change is discarded and request is aborted", async () => {
  const requests=[];
  const pager=createAppointmentPager((patient,cursor,signal) => { const d=deferred(); requests.push({signal,...d}); return d.promise; });
  const old=pager.setPatient(p1), fresh=pager.setPatient(p2);
  assert.equal(requests[0].signal.aborted,true);
  requests[1].resolve({items:[{...item,id:"fresh"}],nextCursor:null}); await fresh;
  requests[0].resolve({items:[item],nextCursor:"old"}); await old;
  assert.deepEqual(pager.getSnapshot().items.map(x=>x.id),["fresh"]);
});
test("disposing a session clears private data and ignores outstanding reads", async () => {
  const d=deferred(); let calls=0;
  const pager=createAppointmentPager(async () => { if (++calls===1) return {items:[item],nextCursor:"next"}; return d.promise; });
  await pager.reload(); const pending=pager.more(); pager.dispose();
  assert.equal(pager.getSnapshot().items.length,0); assert.equal(pager.getSnapshot().nextCursor,null);
  d.resolve({items:[item],nextCursor:"late"}); await pending; await pager.reload(); assert.equal(calls,2);
  assert.equal(pager.getSnapshot().items.length,0);
});
const reservation={id:"r",status:"CONFIRMED",startTime:"2030-01-01T16:00:00Z",endTime:"2030-01-01T18:00:00Z"};
test("complete calendar filters unconfirmed reservations without reading pages", async () => {
  const signal=new AbortController().signal;
  const result=await confirmedReservationsForDay("2030-01-01",signal,async (from,to,s) => {
    assert.equal(from,to); assert.equal(from,"2030-01-01"); assert.equal(s,signal);
    return {items:[reservation,{...reservation,id:"pending",status:"PENDING"}],truncated:false};
  },async()=>{throw new Error("must not page");});
  assert.deepEqual(result,[reservation]);
});
test("truncated calendar follows every needed page beyond 50 candidates", async () => {
  const calls=[];
  const result=await confirmedReservationsForDay("2030-01-01",new AbortController().signal,async()=>({items:[],truncated:true}),async cursor=>{
    const n=cursor ? Number(cursor) : 0; calls.push(cursor);
    return {items:Array.from({length:20},(_,i)=>({...reservation,id:`${n+i}`})),nextCursor:n<40 ? String(n+20) : null};
  });
  assert.equal(result.length,60); assert.deepEqual(calls,[null,"20","40"]);
});
test("paginated reservation fallback stops at following day and deduplicates", async () => {
  let calls=0;
  const result=await confirmedReservationsForDay("2030-01-01",new AbortController().signal,async()=>({items:[],truncated:true}),async()=>{
    calls++; return {items:[reservation,reservation,{...reservation,id:"tomorrow",startTime:"2030-01-02T06:00:00Z"}],nextCursor:"later"};
  });
  assert.equal(calls,1); assert.deepEqual(result,[reservation]);
});
test("reservation fallback propagates page 2 error, never partial success", async () => {
  await assert.rejects(confirmedReservationsForDay("2030-01-01",new AbortController().signal,async()=>({items:[],truncated:true}),async cursor=> {
    if(cursor) throw new Error("offline"); return {items:[reservation],nextCursor:"next"};
  }),/offline/);
});
test("reservation fallback rejects repeated cursors", async () => {
  await assert.rejects(confirmedReservationsForDay("2030-01-01",new AbortController().signal,async()=>({items:[],truncated:true}),async()=>({items:[],nextCursor:"same"})),/cursor/);
});
test("invalid dates perform no reads and an aborted reservation read never succeeds", async () => {
  const controller=new AbortController(); let calls=0;
  assert.deepEqual(await confirmedReservationsForDay("bad",controller.signal,async()=>{calls++;},async()=>{}),[]); assert.equal(calls,0);
  const d=deferred(); const pending=confirmedReservationsForDay("2030-01-01",controller.signal,()=>d.promise,async()=>{});
  controller.abort(); d.resolve({items:[reservation],truncated:false}); await assert.rejects(pending,/Cancelled/);
});

const vm=require("node:vm");
const jsx=(type,props,key)=>({type,props,key});
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=="object")return[];return[tree,...nodes(tree.props?.children)];}
function dailyFixture(data=null,loading=false,error=null){
  let version=3,index=0,read;const cells=[],calls=[];
  const react={useState:initial=>{const i=index++;if(!cells[i])cells[i]={value:typeof initial==="function"?initial():initial};return[cells[i].value,value=>cells[i].value=value];},useCallback:fn=>fn};
  const stubs={react,"react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"Fragment"},"expo-router":{router:{}},"react-native":{Text:"Text",View:"View"},
    "../../components/booking-ui":{Page:"Page",Action:"Action",LoadState:"LoadState",styles:{}},"../../components/admin-ui":{Choice:"Choice",DateNavigator:"DateNavigator"},
    "../../components/auth-input":{AuthInput:"FormInput"},"../../hooks/use-patient-list":{},"../../hooks/use-appointment-history":{},
    "../../hooks/use-resource":{useResource:fn=>{read=fn;return{data,loading,error,reload:async()=>{}};}},
    "../../services/api":{session:{getVersion:()=>version,getTokens:()=>({})}},"../../services/booking":require("../src/services/booking.ts"),
    "../../services/calendar":require("../src/services/calendar.ts"),"../../services/appointment-schedule":require("../src/services/appointment-schedule.ts"),
    "../../services/patients":{},"../../services/patient-pager":{},"../../services/appointments":{getAppointmentCalendar:(...args)=>{const d=deferred();calls.push({args,...d});return d.promise;}}};
  const file=require.resolve("../src/app/appointments/index.tsx"),module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText+
    "\nexports.agendaForTest=Agenda;exports.dailyForTest=Daily;",{module,exports:module.exports,require:name=>{assert.ok(name in stubs,name);return stubs[name];}});
  return{agenda:()=>{index=0;return module.exports.agendaForTest({version});},daily:day=>module.exports.dailyForTest({day,version}),
    read:signal=>read(signal),calls,changeSession:()=>version++};
}
test("actual agenda changes resource key immediately with day and session",()=>{
  const f=dailyFixture();const first=f.agenda();const daily=nodes(first).find(n=>typeof n.type==="function"&&n.type.name==="Daily");
  assert.equal(daily.props.day,businessDate());assert.equal(daily.key,`3:${businessDate()}`);
  nodes(first).find(n=>n.type==="DateNavigator").props.onChange("2030-01-02");
  const next=nodes(f.agenda()).find(n=>typeof n.type==="function"&&n.type.name==="Daily");assert.equal(next.key,"3:2030-01-02");
  f.changeSession();assert.equal(nodes(f.agenda()).find(n=>typeof n.type==="function"&&n.type.name==="Daily").key,"4:2030-01-02");
});
test("actual daily endpoint receives selected day twice and abort signal; old session response is discarded",async()=>{
  const f=dailyFixture();f.daily("2030-01-01");const signal=new AbortController().signal;const pending=f.read(signal);
  assert.deepEqual(f.calls[0].args,["2030-01-01","2030-01-01",signal]);f.changeSession();
  f.calls[0].resolve({items:[item],truncated:false});await assert.rejects(pending,/Session changed/);
});
test("actual daily UI shows truncation and success empty, never false empty on error/loading",()=>{
  const text=f=>nodes(f.daily("2030-01-01")).filter(n=>n.type==="Text").map(n=>n.props.children);
  assert.ok(text(dailyFixture({items:[],truncated:true})).includes(truncationMessage));
  assert.ok(text(dailyFixture({items:[],truncated:false})).includes("No tienes citas para este día."));
  for(const f of [dailyFixture(null,false,"offline"),dailyFixture(null,true,null)])assert.equal(text(f).includes("No tienes citas para este día."),false);
});
test("history hook actually disposes on session change and hides old filter immediately", async () => {
  const cells=[], effects=[], focuses=[], listeners=new Set(), requests=[]; let index=0,version=0;
  const react={
    useMemo:(fn,deps)=>{const i=index++; if(!cells[i] || cells[i].deps[0]!==deps[0]) cells[i]={value:fn(),deps}; return cells[i].value;},
    useCallback:fn=>fn,
    useEffect:fn=>effects.push(fn),
    useSyncExternalStore:(_subscribe,get)=>get(),
  };
  const session={getVersion:()=>version,getTokens:()=>({}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const stubs={react,"react-native":{AppState:{addEventListener:()=>({remove(){}})}},"expo-router":{useFocusEffect:fn=>focuses.push(fn)},
    "../services/api":{session},"../services/appointment-schedule":{createAppointmentPager},
    "../services/appointments":{getAppointmentPage:(patient,cursor,signal)=>{const d=deferred();requests.push({patient,cursor,signal,...d});return d.promise;}}};
  const file=require.resolve("../src/hooks/use-appointment-history.ts"); const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,require:name=>{assert.ok(name in stubs,name);return stubs[name];}});
  const render=patient=>{index=0;return module.exports.useAppointmentHistory(patient,0);};
  let state=render(null); const cleanup=effects.shift()(); const blur=focuses.shift()();
  requests[0].resolve({items:[item],nextCursor:"old"}); await tick(); assert.equal(render(null).state.items.length,1);
  state=render(p2); assert.equal(state.state.items.length,0); assert.equal(state.state.nextCursor,null);
  const pending=state.more();
  version++; listeners.forEach(fn=>fn());
  assert.equal(requests[1].signal.aborted,true);
  assert.equal(render(null).state.items.length,0); assert.equal(render(null).state.nextCursor,null);
  requests[1].resolve({items:[item],nextCursor:"late"}); await pending;
  assert.equal(render(null).state.items.length,0); blur(); cleanup();
});
