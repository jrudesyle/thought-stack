import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE notebooks (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '{}',
  notebook_id TEXT NOT NULL REFERENCES notebooks(id),
  is_trashed INTEGER NOT NULL DEFAULT 0,
  trashed_at TEXT,
  original_notebook_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body_text,
  content=notes, content_rowid=rowid,
  tokenize='porter unicode61'
);
CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body_text) VALUES (new.rowid, new.title, '');
END;
`);

db.exec("INSERT INTO notebooks (id, name) VALUES ('nb1', 'Test')");
db.exec("INSERT INTO notes (id, title, content, notebook_id) VALUES ('n1', 'Meeting notes', '{}', 'nb1')");

// First reindex: delete trigger-inserted entry (body=''), insert with real body
db.prepare("INSERT INTO notes_fts(notes_fts, rowid, title, body_text) VALUES('delete', ?, ?, ?)").run(1, "Meeting notes", "");
db.prepare("INSERT INTO notes_fts(rowid, title, body_text) VALUES(?, ?, ?)").run(1, "Meeting notes", "original content here");

let r = db.prepare("SELECT n.id FROM notes_fts INNER JOIN notes n ON n.rowid = notes_fts.rowid WHERE notes_fts MATCH 'original'").all();
console.log("After 1st reindex, search 'original':", r.length);

// Second reindex: delete with OLD body text, insert with NEW body text
db.prepare("INSERT INTO notes_fts(notes_fts, rowid, title, body_text) VALUES('delete', ?, ?, ?)").run(1, "Meeting notes", "original content here");
db.prepare("INSERT INTO notes_fts(rowid, title, body_text) VALUES(?, ?, ?)").run(1, "Meeting notes", "new replacement text");

r = db.prepare("SELECT n.id FROM notes_fts INNER JOIN notes n ON n.rowid = notes_fts.rowid WHERE notes_fts MATCH 'original'").all();
console.log("After 2nd reindex, search 'original':", r.length);
r = db.prepare("SELECT n.id FROM notes_fts INNER JOIN notes n ON n.rowid = notes_fts.rowid WHERE notes_fts MATCH 'replacement'").all();
console.log("After 2nd reindex, search 'replacement':", r.length);

db.close();
