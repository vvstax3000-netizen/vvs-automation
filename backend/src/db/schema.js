const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'vvs.db');

let db;

async function getDb() {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  migrate();
  initTables();
  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      industry TEXT,
      address TEXT,
      contact_person TEXT,
      phone TEXT,
      contract_start DATE,
      contract_end DATE,
      naver_api_license TEXT,
      naver_api_secret TEXT,
      naver_customer_id TEXT,
      meta_ad_account_id TEXT,
      meta_campaign_ids TEXT,
      place_name TEXT,
      slug TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      memo TEXT DEFAULT '',
      search_volume INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS rank_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL,
      rank INTEGER,
      visitor_reviews INTEGER DEFAULT 0,
      blog_reviews INTEGER DEFAULT 0,
      recorded_date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('meta_cpm', '7000')");

  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_keyword_date ON rank_records(keyword_id, recorded_date)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug) WHERE slug IS NOT NULL AND slug != ""');
}

function migrate() {
  const clientCols = getColumns('clients');
  if (clientCols.length) {
    if (!clientCols.includes('place_name')) db.run('ALTER TABLE clients ADD COLUMN place_name TEXT');
    if (!clientCols.includes('slug')) db.run('ALTER TABLE clients ADD COLUMN slug TEXT');
    if (!clientCols.includes('meta_campaign_ids')) db.run('ALTER TABLE clients ADD COLUMN meta_campaign_ids TEXT');
  }

  const rankCols = getColumns('rank_records');
  if (rankCols.length) {
    if (!rankCols.includes('visitor_reviews')) db.run('ALTER TABLE rank_records ADD COLUMN visitor_reviews INTEGER DEFAULT 0');
    if (!rankCols.includes('blog_reviews')) db.run('ALTER TABLE rank_records ADD COLUMN blog_reviews INTEGER DEFAULT 0');
  }
}

function getColumns(table) {
  const result = db.exec(`PRAGMA table_info(${table})`);
  return result.length ? result[0].values.map(row => row[1]) : [];
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const lastId = db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0];
  save();
  return { lastInsertRowid: lastId, changes };
}

module.exports = { getDb, save, queryAll, queryOne, run };
