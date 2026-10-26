const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const { createServer } = require("../server");
const { openDatabase } = require("../database");

let baseUrl;
let server;
let databasePath;

test.before(async () => {
  databasePath = path.join(os.tmpdir(), `cecyto-vial-test-${process.pid}.sqlite`);
  await fs.rm(databasePath, { force: true });
  server = createServer(databasePath);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const database = new DatabaseSync(databasePath);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM assessments").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM assessment_answers").get().count, 1);
  database.close();
  const reopenedDatabase = openDatabase(databasePath);
  assert.equal(reopenedDatabase.prepare("SELECT COUNT(*) AS count FROM assessments").get().count, 1);
  assert.equal(reopenedDatabase.prepare("SELECT COUNT(*) AS count FROM assessment_answers").get().count, 1);
  reopenedDatabase.close();
  await fs.rm(databasePath, { force: true });
  await fs.rm(`${databasePath}-shm`, { force: true });
  await fs.rm(`${databasePath}-wal`, { force: true });
});

test("sirve la interfaz principal", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
});

test("expone faltas y preguntas sin respuestas correctas", async () => {
  const [faultsResponse, questionsResponse] = await Promise.all([
    fetch(`${baseUrl}/api/faults?category=Movilidad`),
    fetch(`${baseUrl}/api/questions`)
  ]);
  assert.equal(faultsResponse.status, 200);
  assert.equal((await faultsResponse.json()).length, 2);
  const questions = await questionsResponse.json();
  assert.equal(questions.length, 8);
  assert.equal("correctIndex" in questions[0], false);
});

test("muestra referencias oficiales y no presenta grados legales inventados", async () => {
  const response = await fetch(`${baseUrl}/api/faults`);
  const faults = await response.json();
  assert.equal(faults.length, 6);
  assert.ok(faults.every((fault) => fault.sourceUrl.includes("villavictoria.edomex.gob.mx")));
  assert.ok(faults.every((fault) => fault.legalReference.includes("Bando Municipal 2026")));
  assert.deepEqual(
    [...new Set(faults.map((fault) => fault.category))].sort(),
    ["Alcoholímetro", "Justicia Cívica", "Movilidad", "Seguridad vial"].sort()
  );
});

test("filtra categorías no existentes sin devolver faltas", async () => {
  const response = await fetch(`${baseUrl}/api/faults?category=NoExiste`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test("califica respuestas en el servidor y rechaza envíos inválidos", async () => {
  const response = await fetch(`${baseUrl}/api/assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: [{ questionId: "q1", selectedIndex: 0 }] })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.score, 1);
  assert.equal(result.total, 1);

  const invalid = await fetch(`${baseUrl}/api/assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: [{ questionId: "q1", selectedIndex: 99 }] })
  });
  assert.equal(invalid.status, 400);

  const unknown = await fetch(`${baseUrl}/api/assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: [{ questionId: "desconocida", selectedIndex: 0 }] })
  });
  assert.equal(unknown.status, 400);
});

test("migra una base de datos de una versión anterior", async () => {
  const legacyPath = path.join(os.tmpdir(), `cecyto-vial-legacy-${process.pid}.sqlite`);
  await fs.rm(legacyPath, { force: true });
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE fault_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE traffic_faults (
      id TEXT PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES fault_categories(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      sanction_note TEXT NOT NULL
    );
    INSERT INTO fault_categories (id, name) VALUES (1, 'Grave');
    INSERT INTO traffic_faults (id, category_id, title, description, recommendation, sanction_note)
    VALUES ('grave-celular', 1, 'Registro anterior', 'Registro de prueba', 'No aplica', 'No aplica');
  `);
  legacy.close();

  const migrated = openDatabase(legacyPath);
  const columns = migrated.prepare("PRAGMA table_info(traffic_faults)").all().map((column) => column.name);
  assert.ok(columns.includes("legal_reference"));
  assert.ok(columns.includes("source_url"));
  assert.ok(columns.includes("icon"));
  assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM traffic_faults").get().count, 6);
  assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM traffic_faults WHERE id = 'grave-celular'").get().count, 0);
  assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM fault_categories").get().count, 4);
  migrated.close();
  await fs.rm(legacyPath, { force: true });
  await fs.rm(`${legacyPath}-shm`, { force: true });
  await fs.rm(`${legacyPath}-wal`, { force: true });
});
