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
    fetch(`${baseUrl}/api/faults?category=Grave`),
    fetch(`${baseUrl}/api/questions`)
  ]);
  assert.equal(faultsResponse.status, 200);
  assert.equal((await faultsResponse.json()).length, 2);
  const questions = await questionsResponse.json();
  assert.equal(questions.length, 8);
  assert.equal("correctIndex" in questions[0], false);
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
