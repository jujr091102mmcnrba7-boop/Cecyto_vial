PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fault_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS traffic_faults (
  id TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES fault_categories(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  sanction_note TEXT NOT NULL,
  legal_reference TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  fault_id TEXT NOT NULL REFERENCES traffic_faults(id),
  question TEXT NOT NULL,
  explanation TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_options (
  id INTEGER PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  option_order INTEGER NOT NULL,
  option_text TEXT NOT NULL,
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  UNIQUE (question_id, option_order)
);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assessment_answers (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES quiz_questions(id),
  selected_option_id INTEGER NOT NULL REFERENCES quiz_options(id),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  PRIMARY KEY (assessment_id, question_id)
);
