const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "cozybot.db");

const SCORE_MIN = -20;
const SCORE_MAX = 100;
const MAX_MARRIAGES = 3;

const THRESHOLDS = {
  date: 30,
  propose: 80,
};

let db;
let prepared = null;

function clampScore(score) {
  if (score < SCORE_MIN) return SCORE_MIN;
  if (score > SCORE_MAX) return SCORE_MAX;
  return score;
}

function normalizePair(userId1, userId2) {
  if (!userId1 || !userId2) throw new Error("Both user IDs are required.");
  if (userId1 === userId2) throw new Error("User IDs must be different.");

  return userId1 < userId2
    ? { user_a: userId1, user_b: userId2 }
    : { user_a: userId2, user_b: userId1 };
}

function prepareStatements() {
  if (!db) throw new Error("DB is not initialized. Call initDatabase() first.");
  if (prepared) return prepared;

  prepared = {
    upsertUser: db.prepare(
      `INSERT INTO users (user_id, username)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET username = excluded.username`
    ),

    getRelationship: db.prepare(
      `SELECT score FROM relationships WHERE user_a = ? AND user_b = ?`
    ),
    insertRelationship: db.prepare(
      `INSERT OR IGNORE INTO relationships (user_a, user_b, score) VALUES (?, ?, 0)`
    ),
    setRelationship: db.prepare(
      `INSERT INTO relationships (user_a, user_b, score)
       VALUES (?, ?, ?)
       ON CONFLICT(user_a, user_b) DO UPDATE SET score = excluded.score`
    ),

    getMarriageCount: db.prepare(
      `SELECT marriage_count FROM users WHERE user_id = ?`
    ),
    incMarriageCount: db.prepare(
      `UPDATE users SET marriage_count = marriage_count + 1 WHERE user_id = ?`
    ),
    decMarriageCount: db.prepare(
      `UPDATE users SET marriage_count = MAX(marriage_count - 1, 0) WHERE user_id = ?`
    ),

    insertMarriage: db.prepare(
      `INSERT INTO marriages (user_1, user_2) VALUES (?, ?)`
    ),
    deleteMarriageBetween: db.prepare(
      `DELETE FROM marriages
       WHERE (user_1 = ? AND user_2 = ?) OR (user_1 = ? AND user_2 = ?)`
    ),
    findMarriageBetween: db.prepare(
      `SELECT id, user_1, user_2, married_at
       FROM marriages
       WHERE (user_1 = ? AND user_2 = ?) OR (user_1 = ? AND user_2 = ?)
       ORDER BY married_at DESC
       LIMIT 1`
    ),
    listSpouses: db.prepare(
      `SELECT
          CASE WHEN user_1 = ? THEN user_2 ELSE user_1 END AS spouse_id,
          married_at
       FROM marriages
       WHERE user_1 = ? OR user_2 = ?
       ORDER BY married_at DESC`
    ),
  };

  return prepared;
}

function initDatabase() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      marriage_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS relationships (
      user_a TEXT,
      user_b TEXT,
      score INTEGER DEFAULT 0,
      PRIMARY KEY (user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS marriages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_1 TEXT,
      user_2 TEXT,
      married_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_1) REFERENCES users(user_id),
      FOREIGN KEY (user_2) REFERENCES users(user_id)
    );
  `);

  prepareStatements();
  return db;
}

function ensureUser(userId, username) {
  const s = prepareStatements();
  s.upsertUser.run(String(userId), username ? String(username) : null);
}

function getRelationshipScore(userId1, userId2) {
  const s = prepareStatements();
  const { user_a, user_b } = normalizePair(String(userId1), String(userId2));
  const row = s.getRelationship.get(user_a, user_b);
  return row ? row.score : 0;
}

function setRelationshipScore(userId1, userId2, newScore) {
  const s = prepareStatements();
  const { user_a, user_b } = normalizePair(String(userId1), String(userId2));
  const clamped = clampScore(Number(newScore));
  s.setRelationship.run(user_a, user_b, clamped);
  return clamped;
}

function adjustRelationshipScore(userId1, userId2, delta) {
  const s = prepareStatements();
  const { user_a, user_b } = normalizePair(String(userId1), String(userId2));

  s.insertRelationship.run(user_a, user_b);
  const current = getRelationshipScore(user_a, user_b);
  const next = clampScore(current + Number(delta));
  s.setRelationship.run(user_a, user_b, next);
  return { before: current, after: next, delta: next - current };
}

function canDate(userId1, userId2) {
  const score = getRelationshipScore(userId1, userId2);
  return { ok: score >= THRESHOLDS.date, score, required: THRESHOLDS.date };
}

function canPropose(userId1, userId2) {
  const score = getRelationshipScore(userId1, userId2);
  return { ok: score >= THRESHOLDS.propose, score, required: THRESHOLDS.propose };
}

function getMarriageCount(userId) {
  const s = prepareStatements();
  const row = s.getMarriageCount.get(String(userId));
  return row ? Number(row.marriage_count) : 0;
}

function addMarriage(userId1, userId2) {
  const s = prepareStatements();
  const a = String(userId1);
  const b = String(userId2);
  if (a === b) throw new Error("Cannot marry the same user.");

  const tx = db.transaction(() => {
    s.upsertUser.run(a, null);
    s.upsertUser.run(b, null);
    s.insertMarriage.run(a, b);
    s.incMarriageCount.run(a);
    s.incMarriageCount.run(b);
  });
  tx();
}

function findMarriageBetween(userId1, userId2) {
  const s = prepareStatements();
  const a = String(userId1);
  const b = String(userId2);
  return s.findMarriageBetween.get(a, b, b, a) || null;
}

function removeMarriage(userId1, userId2) {
  const s = prepareStatements();
  const a = String(userId1);
  const b = String(userId2);

  const tx = db.transaction(() => {
    const existing = s.findMarriageBetween.get(a, b, b, a);
    if (!existing) return false;

    s.deleteMarriageBetween.run(a, b, b, a);
    s.decMarriageCount.run(a);
    s.decMarriageCount.run(b);
    return true;
  });

  return tx();
}

function listSpouses(userId) {
  const s = prepareStatements();
  const id = String(userId);
  return s.listSpouses.all(id, id, id).map((r) => ({
    spouseId: r.spouse_id,
    marriedAt: r.married_at,
  }));
}

function relationshipBar(score) {
  const clamped = Math.max(0, Math.min(100, Number(score)));
  const filled = Math.round((clamped / 100) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

module.exports = {
  initDatabase,
  ensureUser,

  SCORE_MIN,
  SCORE_MAX,
  MAX_MARRIAGES,
  THRESHOLDS,

  normalizePair,
  clampScore,

  getRelationshipScore,
  setRelationshipScore,
  adjustRelationshipScore,

  canDate,
  canPropose,

  getMarriageCount,
  addMarriage,
  findMarriageBetween,
  removeMarriage,
  listSpouses,

  relationshipBar,
  DB_PATH,
};

