const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename,
}).outputText,filename);
const helpers=require("../src/services/appointment-form.ts");
const schedule=require("../src/services/appointment-schedule.ts");
const booking=require("../src/services/booking.ts");
const {appointmentInstant,appointmentErrors,appointmentPayload,appointmentPatch,containsAppointment,formFromAppointment,appointmentServerErrors}=helpers;
const form={patientId:"patient",reservationId:"reservation",date:"2030-01-01",start:"10:00",end:"10:30"};
const reservation={id:"reservation",status:"CONFIRMED",startTime:"2030-01-01T16:00:00.000Z",endTime:"2030-01-01T20:00:00.000Z",room:{id:"room",name:"Sala fixture"}};
const now=Date.parse("2030-01-01T15:00:00Z");
const item={id:"appointment",status:"SCHEDULED",startTime:reservation.startTime,endTime:"2030-01-01T16:30:00.000Z",
  patient:{id:"patient",firstName:"Fixture",lastName:"Patient"},reservation,needsRoomReview:false};
test("date and time convert to explicit UTC instants including both day edges",()=>{
  assert.equal(appointmentInstant(form.date,form.start),"2030-01-01T16:00:00.000Z");
  assert.equal(appointmentInstant(form.date,"00:00"),"2030-01-01T06:00:00.000Z");
  assert.equal(appointmentInstant(form.date,"23:55"),"2030-01-02T05:55:00.000Z");
});
test("actual different device timezones leave conversion and prefill unchanged",()=>{
  const previous=process.env.TZ; const hours=[];
  try { for(const zone of ["America/Los_Angeles","Asia/Tokyo"]){process.env.TZ=zone;hours.push(new Date(item.startTime).getHours());
    assert.equal(appointmentInstant(form.date,form.start),"2030-01-01T16:00:00.000Z");
    assert.deepEqual(formFromAppointment(item),form);
  } assert.notEqual(hours[0],hours[1]); }
  finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
for(const [date,time] of [["2030-02-30","10:00"],["bad","10:00"],[form.date,"24:00"],[form.date,"10:01:00"],[form.date,"10:00:00.001"],[form.date,"10:60"]])
  test(`invalid date/precision ${date} ${time}`,()=>assert.equal(appointmentInstant(date,time),null));
for(const [field,value] of [["start","10:01"],["end","10:31"]])
  test(`${field} must align to five minutes`,()=>assert.ok(appointmentErrors({...form,[field]:value},reservation,now)[field]));
for(const end of ["10:15","14:00"])
  test(`accepts duration boundary ${end}`,()=>assert.deepEqual(appointmentErrors({...form,end},reservation,now),{}));
for(const end of ["10:10","14:05","09:55","10:00"])
  test(`rejects duration ${end}`,()=>assert.ok(appointmentErrors({...form,end},reservation,now).end));
test("start must be strictly future",()=>{
  assert.ok(appointmentErrors(form,reservation,Date.parse(item.startTime)).start);
  assert.ok(appointmentErrors(form,reservation,Date.parse(item.startTime)+1).start);
});
test("reservation containment includes equal boundaries and excludes pending/expired/cancelled",()=>{
  const start=appointmentInstant(form.date,form.start),end=appointmentInstant(form.date,form.end);
  assert.equal(containsAppointment(reservation,start,end),true);
  assert.ok(appointmentErrors({...form,start:"09:55"},reservation,now).reservationId);
  assert.ok(appointmentErrors(form,undefined,now).reservationId);
  for(const status of ["PENDING","EXPIRED","CANCELLED","COMPLETED"])
    assert.equal(containsAppointment({...reservation,status},start,end),false);
});
test("consecutive intervals are accepted without inventing client overlap authority",()=>{
  assert.deepEqual(appointmentErrors(form,reservation,now),{});
  assert.deepEqual(appointmentErrors({...form,start:"10:30",end:"11:00"},reservation,now),{});
});
test("creation and update payloads whitelist fields; update never changes patient",()=>{
  const hostile={...form,doctorId:"private",roomId:"room",notes:"private",status:"COMPLETED"};
  assert.deepEqual(appointmentPayload(hostile),{patientId:"patient",reservationId:"reservation",startTime:item.startTime,endTime:item.endTime});
  assert.deepEqual(appointmentPatch(hostile),{reservationId:"reservation",startTime:item.startTime,endTime:item.endTime});
});
test("400 validation maps DTO and interval messages to safe corresponding fields",()=>{
  const mapped=appointmentServerErrors(["patientId must be a UUID","reservationId must be a UUID","startTime must be a string","endTime must be a string"]);
  assert.deepEqual(Object.keys(mapped.fields),["patientId","reservationId","start","end"]); assert.equal(mapped.general,null);
  assert.ok(appointmentServerErrors("Appointment must be within reservation").fields.reservationId);
  assert.ok(appointmentServerErrors("Appointment times must use five-minute precision").fields.start);
  assert.ok(appointmentServerErrors("SELECT private").general); assert.equal(appointmentServerErrors("SELECT private").general.includes("SELECT"),false);
});
const jsx=(type,props,key)=>({type,props,key});
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=="object")return[];return[tree,...nodes(tree.props?.children)];}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(mode="editor",original=null){
  const cells=[],effects=[],writes=[],routes=[],alerts=[];let index=0,version=0,clock=now,reloads=0;
  const react={useState:initial=>{const i=index++;if(!cells[i])cells[i]={value:typeof initial==="function"?initial():initial};return[cells[i].value,value=>{cells[i].value=typeof value==="function"?value(cells[i].value):value;}];},
    useRef:initial=>{const i=index++;return cells[i]??(cells[i]={current:initial});},useEffect:fn=>{const i=index++;if(!cells[i])effects.push(()=>{cells[i]={cleanup:fn()};});},useCallback:fn=>fn};
  const api={session:{getVersion:()=>version,getTokens:()=>({})}};
  const resource={data:original,loading:false,error:null,reload:async()=>{reloads++;}};
  const stubs={react,axios:{isAxiosError:e=>!!e.isAxiosError},"react/jsx-runtime":{jsx,jsxs:jsx,Fragment:"Fragment"},
    "react-native":{KeyboardAvoidingView:"KeyboardAvoidingView",Platform:{OS:"ios"},Text:"Text",View:"View",Alert:{alert:(...args)=>alerts.push(args)}},
    "expo-router":{router:{replace:route=>routes.push(route),push:route=>routes.push(route)},useLocalSearchParams:()=>({})},
    "../../components/booking-ui":{Page:"Page",Action:"Action",LoadState:"LoadState",styles:{}},
    "../../components/auth-input":{AuthInput:"FormInput"},"../../components/admin-ui":{Choice:"Choice"},"./index":{PatientPicker:"PatientPicker"},
    "../../hooks/use-patient-list":{usePatientIdentity:()=>version},"../../hooks/use-resource":{useResource:()=>resource},"../../hooks/use-now":{useNow:()=>clock},
    "../../services/api":api,"../../services/booking":booking,"../../services/appointment-form":helpers,"../../services/appointment-schedule":schedule,
    "../../services/errors":{getErrorMessage:()=>"Error de conexión. Intenta de nuevo."},"../../services/reservations":{},
    "../../services/appointments":Object.fromEntries(["createAppointment","updateAppointment","getAppointment","cancelAppointment","completeAppointment"].map(method=>[method,(...args)=>{const d=deferred();writes.push({method,args,...d});return d.promise;}]))};
  class ClockDate extends Date {static now(){return clock;}}
  const file=require.resolve(mode==="editor"?"../src/app/appointments/form.tsx":"../src/app/appointments/[id].tsx");const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText+
    `\nexports.subject = ${mode==="editor"?"AppointmentEditor":"Detail"};`,{module,exports:module.exports,Date:ClockDate,require:name=>{assert.ok(name in stubs,name);return stubs[name];}});
  const render=()=>{index=0;const tree=module.exports.subject(mode==="editor"?{original,patientId:"",version:0}:{id:"appointment",version:0});while(effects.length)effects.shift()();return tree;};
  const action=title=>nodes(render()).find(n=>n.type==="Action"&&n.props.title===title);
  const change=(label,value)=>nodes(render()).find(n=>n.type==="FormInput"&&n.props.accessibilityLabel===label).props.onChangeText(value);
  function fill(){const tree=render();nodes(tree).find(n=>n.type==="PatientPicker")?.props.onSelect("patient");
    change("Fecha",form.date);change("Hora de inicio",form.start);change("Hora de fin",form.end);
    const picker=nodes(render()).find(n=>typeof n.type==="function"&&n.type.name==="ReservationPicker");picker.props.onLoaded([reservation]);picker.props.onSelect(reservation.id);}
  return{render,action,change,fill,writes,routes,alerts,cells,changeSession:()=>version++,setNow:value=>clock=value,getReloads:()=>reloads,
    unmount:()=>cells.forEach(cell=>cell?.cleanup?.())};
}
test("actual form blocks double create before React rerenders and disables busy button",async()=>{
  const f=fixture();f.fill();const submit=f.action("Guardar cita").props.onPress;submit();submit();
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].method,"createAppointment");assert.deepEqual(Object.keys(f.writes[0].args[0]),["patientId","reservationId","startTime","endTime"]);
  assert.equal(f.action("Guardando...").props.disabled,true);f.writes[0].resolve(item);await tick();assert.deepEqual(Object.keys(f.routes[0].params),["id"]);f.unmount();
});
test("actual reschedule keeps patient immutable and sends only times/reservation",async()=>{
  const f=fixture("editor",item);const tree=f.render();assert.equal(nodes(tree).some(n=>n.type==="PatientPicker"),false);
  const picker=nodes(tree).find(n=>typeof n.type==="function"&&n.type.name==="ReservationPicker");picker.props.onLoaded([reservation]);
  f.action("Guardar cita").props.onPress();assert.equal(f.writes[0].method,"updateAppointment");assert.deepEqual(Object.keys(f.writes[0].args[1]),["reservationId","startTime","endTime"]);
  f.writes[0].resolve(item);await tick();f.unmount();
});
test("400 stays in corresponding input; network failure preserves written draft",async()=>{
  const f=fixture();f.fill();f.action("Guardar cita").props.onPress();f.writes[0].reject({isAxiosError:true,response:{status:400,data:{message:["startTime must be a string"]}}});await tick();
  assert.match(nodes(f.render()).find(n=>n.type==="FormInput"&&n.props.accessibilityLabel==="Hora de inicio").props.error,/inicio/);
  f.action("Guardar cita").props.onPress();f.writes[1].reject(new Error("offline"));await tick();
  assert.equal(nodes(f.render()).find(n=>n.type==="FormInput"&&n.props.accessibilityLabel==="Fecha").props.value,form.date);assert.equal(f.action("Guardar cita").props.disabled,false);f.unmount();
});
test("404 blocks additional writes with safe resource unavailable message",async()=>{
  const f=fixture();f.fill();f.action("Guardar cita").props.onPress();f.writes[0].reject({isAxiosError:true,response:{status:404}});await tick();
  assert.equal(f.action("Guardar cita").props.disabled,true);f.action("Guardar cita").props.onPress();assert.equal(f.writes.length,1);f.unmount();
});
test("409 is actionable without leaking internal content and preserves draft",async()=>{
  const f=fixture();f.fill();f.action("Guardar cita").props.onPress();f.writes[0].reject({isAxiosError:true,response:{status:409,data:{message:"Appointment overlaps another appointment"}}});await tick();
  assert.ok(nodes(f.render()).some(n=>n.type==="Text"&&String(n.props.children).includes("superpone")));assert.equal(f.action("Guardar cita").props.disabled,false);f.unmount();
});
for(const action of ["changeSession","unmount"])
  test(`old create response never navigates after ${action}`,async()=>{
    const f=fixture();f.fill();f.action("Guardar cita").props.onPress();f[action]();f.writes[0].resolve(item);await tick();assert.deepEqual(f.routes,[]);f.unmount();
  });
test("changed session before submit prevents HTTP write",()=>{
  const f=fixture();f.fill();f.changeSession();f.action("Guardar cita").props.onPress();assert.equal(f.writes.length,0);f.unmount();
});
test("actual detail cancel requires confirmation and only calls appointments cancel",async()=>{
  const f=fixture("detail",item);f.action("Cancelar cita").props.onPress();assert.equal(f.writes.length,0);assert.equal(f.alerts[0][1],schedule.cancelMessage);
  f.alerts[0][2][1].onPress();f.alerts[0][2][1].onPress();assert.equal(f.writes.length,1);assert.equal(f.writes[0].method,"cancelAppointment");assert.equal(f.writes[0].args[0],item.id);
  f.writes[0].resolve({...item,status:"CANCELLED"});await tick();assert.equal(f.getReloads(),1);f.unmount();
});
test("completion hidden before start, enabled at start, reloads after success",async()=>{
  const f=fixture("detail",item);assert.equal(f.action("Marcar como completada"),undefined);f.setNow(Date.parse(item.startTime));
  assert.equal(f.action("Reprogramar"),undefined);f.action("Marcar como completada").props.onPress();assert.equal(f.writes[0].method,"completeAppointment");
  f.writes[0].resolve({...item,status:"COMPLETED"});await tick();assert.equal(f.getReloads(),1);f.unmount();
});
test("confirmation accepted after session change cannot cancel old appointment",()=>{
  const f=fixture("detail",item);f.action("Cancelar cita").props.onPress();f.changeSession();f.alerts[0][2][1].onPress();assert.equal(f.writes.length,0);f.unmount();
});
test("old detail transition response cannot refresh into a new session",async()=>{
  const f=fixture("detail",item);f.setNow(Date.parse(item.startTime));f.action("Marcar como completada").props.onPress();
  f.changeSession();f.writes[0].resolve({...item,status:"COMPLETED"});await tick();assert.equal(f.getReloads(),0);f.unmount();
});
test("actual HTTP services use existing client, pinned session, precise routes and no reservation writes",async()=>{
  const calls=[],session={getVersion:()=>7};const api={};for(const method of ["get","post","patch"])api[method]=async(...args)=>{calls.push({method,args});return{data:item};};
  const file=require.resolve("../src/services/appointments.ts"),module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,require:name=>{assert.equal(name,"./api");return{api,session};}});
  const service=module.exports,signal=new AbortController().signal;
  await service.getAppointmentCalendar(form.date,form.date,signal);await service.getAppointmentPage("patient","cursor",signal);await service.getAppointmentPage(undefined,null,signal);
  await service.getAppointment("id/unsafe",signal);await service.createAppointment(appointmentPayload(form));await service.updateAppointment(item.id,appointmentPatch(form));
  await service.cancelAppointment(item.id);await service.completeAppointment(item.id);
  assert.deepEqual(calls.map(c=>c.args[0]),["/appointments/calendar","/appointments/page","/appointments/page","/appointments/id%2Funsafe","/appointments","/appointments/appointment","/appointments/appointment/cancel","/appointments/appointment/complete"]);
  assert.deepEqual(Object.keys(calls[2].args[1].params),[]);assert.equal(calls[1].args[1].params.patientId,"patient");assert.equal(calls[1].args[1].params.cursor,"cursor");
  for(const c of calls)assert.equal(c.args[c.method==="get"?1:2]._sessionVersion,7);
  assert.equal(calls[6].args[1],undefined);assert.equal(calls[7].args[1],undefined);
});
