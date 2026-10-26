const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DEFAULT_PATH = path.join(ROOT, "data", "cecyto-vial.sqlite");

function openDatabase(databasePath = DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(fs.readFileSync(path.join(ROOT, "database", "schema.sql"), "utf8"));
  migrateFaultSourceColumns(database);
  seedDatabase(database);
  return database;
}

function migrateFaultSourceColumns(database) {
  const columns = new Set(database.prepare("PRAGMA table_info(traffic_faults)").all().map((column) => column.name));
  if (!columns.has("legal_reference")) {
    database.exec("ALTER TABLE traffic_faults ADD COLUMN legal_reference TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.has("source_url")) {
    database.exec("ALTER TABLE traffic_faults ADD COLUMN source_url TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.has("icon")) {
    database.exec("ALTER TABLE traffic_faults ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
  }
}

function seedDatabase(database) {
  const faults = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "faults.json"), "utf8"));
  const questions = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "questions.json"), "utf8"));
  const categories = [...new Set(faults.map((fault) => fault.category))];

  database.exec("BEGIN");
  try {
    const insertCategory = database.prepare("INSERT INTO fault_categories (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
    for (const category of categories) insertCategory.run(category);

    const categoryIds = new Map(database.prepare("SELECT id, name FROM fault_categories").all().map((row) => [row.name, row.id]));
    const insertFault = database.prepare(`
      INSERT INTO traffic_faults (
        id, category_id, title, description, recommendation, sanction_note, legal_reference, source_url, icon
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        category_id = excluded.category_id,
        title = excluded.title,
        description = excluded.description,
        recommendation = excluded.recommendation,
        sanction_note = excluded.sanction_note,
        legal_reference = excluded.legal_reference,
        source_url = excluded.source_url,
        icon = excluded.icon
    `);
    for (const fault of faults) {
      insertFault.run(
        fault.id,
        categoryIds.get(fault.category),
        fault.title,
        fault.description,
        fault.recommendation,
        fault.sanctionNote,
        fault.legalReference,
        fault.sourceUrl,
        fault.icon
      );
    }
    const insertQuestion = database.prepare(`
      INSERT INTO quiz_questions (id, fault_id, question, explanation)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fault_id = excluded.fault_id,
        question = excluded.question,
        explanation = excluded.explanation
    `);
    const insertOption = database.prepare(`
      INSERT INTO quiz_options (question_id, option_order, option_text, is_correct)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(question_id, option_order) DO UPDATE SET
        option_text = excluded.option_text,
        is_correct = excluded.is_correct
    `);
    for (const question of questions) {
      insertQuestion.run(question.id, question.faultId, question.question, question.explanation);
      question.options.forEach((option, index) => {
        insertOption.run(question.id, index, option, Number(index === question.correctIndex));
      });
    }
    const seededFaultIds = new Set(faults.map((fault) => fault.id));
    const existingFaultIds = database.prepare("SELECT id FROM traffic_faults").all();
    const deleteFault = database.prepare("DELETE FROM traffic_faults WHERE id = ?");
    for (const { id } of existingFaultIds) {
      if (!seededFaultIds.has(id)) deleteFault.run(id);
    }
    database.exec(`
      DELETE FROM fault_categories
      WHERE id NOT IN (SELECT DISTINCT category_id FROM traffic_faults)
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function getFaults(database, category) {
  const sql = `
    SELECT traffic_faults.id, fault_categories.name AS category, traffic_faults.title,
      traffic_faults.description, traffic_faults.recommendation,
      traffic_faults.sanction_note AS sanctionNote,
      traffic_faults.legal_reference AS legalReference,
      traffic_faults.source_url AS sourceUrl,
      traffic_faults.icon
    FROM traffic_faults
    JOIN fault_categories ON fault_categories.id = traffic_faults.category_id
    ${category ? "WHERE fault_categories.name = ?" : ""}
    ORDER BY fault_categories.id, traffic_faults.title
  `;
  const rows = category ? database.prepare(sql).all(category) : database.prepare(sql).all();
  return rows;
}

function getQuestions(database) {
  const questions = database.prepare(`
    SELECT quiz_questions.id, quiz_questions.fault_id AS faultId,
      quiz_questions.question, quiz_questions.explanation
    FROM quiz_questions
    ORDER BY quiz_questions.id
  `).all();
  const getOptions = database.prepare(`
    SELECT option_text FROM quiz_options WHERE question_id = ? ORDER BY option_order
  `);
  return questions.map((question) => ({
    ...question,
    options: getOptions.all(question.id).map((option) => option.option_text)
  }));
}

function saveAssessment(database, answers) {
  const getQuestion = database.prepare(`
    SELECT quiz_questions.id, quiz_questions.explanation
    FROM quiz_questions WHERE quiz_questions.id = ?
  `);
  const getOption = database.prepare(`
    SELECT id, is_correct FROM quiz_options
    WHERE question_id = ? AND option_order = ?
  `);
  const results = answers.map(({ questionId, selectedIndex }) => {
    const question = getQuestion.get(questionId);
    if (!question) return null;
    const option = getOption.get(questionId, selectedIndex);
    if (!option) return null;
    return {
      questionId,
      selectedOptionId: option.id,
      correct: Boolean(option.is_correct),
      explanation: question.explanation
    };
  });
  if (results.some((result) => result === null)) return null;

  const score = results.filter((result) => result.correct).length;
  database.exec("BEGIN");
  try {
    const assessment = database.prepare(
      "INSERT INTO assessments (score, total, completed_at) VALUES (?, ?, ?)"
    ).run(score, results.length, new Date().toISOString());
    const insertAnswer = database.prepare(`
      INSERT INTO assessment_answers (assessment_id, question_id, selected_option_id, is_correct)
      VALUES (?, ?, ?, ?)
    `);
    for (const result of results) {
      insertAnswer.run(
        assessment.lastInsertRowid,
        result.questionId,
        result.selectedOptionId,
        Number(result.correct)
      );
    }
    database.exec("COMMIT");
    return {
      id: Number(assessment.lastInsertRowid),
      score,
      total: results.length,
      completedAt: database.prepare("SELECT completed_at FROM assessments WHERE id = ?").get(assessment.lastInsertRowid).completed_at,
      results: results.map(({ questionId, correct, explanation }) => ({ questionId, correct, explanation }))
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

module.exports = { DEFAULT_PATH, getFaults, getQuestions, openDatabase, saveAssessment };
