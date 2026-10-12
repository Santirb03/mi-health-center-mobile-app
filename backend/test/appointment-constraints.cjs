const assert = require('node:assert/strict');

async function verifyAppointmentConstraints(client) {
  const extension = await client.query("SELECT extversion FROM pg_extension WHERE extname = 'btree_gist'");
  assert.equal(extension.rows.length, 1, 'btree_gist must be installed');
  const constraints = (await client.query(`SELECT conname, contype, convalidated,
    pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid = 'appointments'::regclass ORDER BY conname`)).rows;
  const required = {
    appointments_end_after_start: 'c', appointments_doctor_no_overlap: 'x',
    appointments_patientId_doctorId_fkey: 'f', appointments_reservationId_doctorId_fkey: 'f',
  };
  for (const [name, type] of Object.entries(required)) {
    const constraint = constraints.find(row => row.conname === name);
    assert.ok(constraint, `Missing ${name}`);
    assert.equal(constraint.contype, type);
    assert.equal(constraint.convalidated, true);
  }
  const definitions = Object.fromEntries(constraints.map(row => [row.conname, row.definition]));
  assert.match(definitions.appointments_end_after_start, /"endTime" > "startTime"/);
  assert.match(definitions.appointments_doctor_no_overlap, /tsrange.*\[\)/);
  assert.match(definitions.appointments_doctor_no_overlap, /status.*<>.*CANCELLED/);
  assert.match(definitions.appointments_patientId_doctorId_fkey, /FOREIGN KEY \("patientId", "doctorId"\).*REFERENCES patients\(id, "doctorId"\).*ON DELETE CASCADE/);
  assert.match(definitions.appointments_reservationId_doctorId_fkey, /FOREIGN KEY \("reservationId", "doctorId"\).*REFERENCES reservations\(id, "doctorId"\).*ON DELETE RESTRICT/);
  const indexes = (await client.query(`SELECT c.relname, i.indisunique, i.indisvalid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname IN ('patients_id_doctorId_key', 'reservations_id_doctorId_key') ORDER BY c.relname`)).rows;
  assert.equal(indexes.length, 2);
  assert.ok(indexes.every(row => row.indisunique && row.indisvalid));
  return { extension: extension.rows[0].extversion, constraints, indexes };
}
module.exports = { verifyAppointmentConstraints };
