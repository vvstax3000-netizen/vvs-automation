-- VVS Marketing Automation - D1 초기 스키마
-- Cloudflare D1 (SQLite) 마이그레이션

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  industry TEXT DEFAULT '',
  address TEXT DEFAULT '',
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  contract_start TEXT DEFAULT '',
  contract_end TEXT DEFAULT '',
  naver_api_license TEXT DEFAULT '',
  naver_api_secret TEXT DEFAULT '',
  naver_customer_id TEXT DEFAULT '',
  meta_ad_account_id TEXT DEFAULT '',
  meta_campaign_ids TEXT DEFAULT '',
  place_name TEXT,
  slug TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  memo TEXT DEFAULT '',
  search_volume INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rank_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL,
  rank INTEGER,
  visitor_reviews INTEGER DEFAULT 0,
  blog_reviews INTEGER DEFAULT 0,
  recorded_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  period_type TEXT DEFAULT 'weekly',
  revenue INTEGER DEFAULT 0,
  visitors INTEGER DEFAULT 0,
  place_views INTEGER DEFAULT 0,
  smart_calls INTEGER DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  unit_price INTEGER DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  naver_ad_cost INTEGER DEFAULT 0,
  meta_ad_cost INTEGER DEFAULT 0,
  meta_ad_cost_actual INTEGER DEFAULT 0,
  meta_ad_cost_markup INTEGER DEFAULT 0,
  use_markup INTEGER DEFAULT 1,
  total_ad_cost INTEGER DEFAULT 0,
  cac INTEGER DEFAULT 0,
  roas REAL DEFAULT 0,
  memo TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keyword_discovery_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  rank INTEGER,
  monthly_pc_qc_cnt INTEGER DEFAULT 0,
  monthly_mobile_qc_cnt INTEGER DEFAULT 0,
  total_search_volume INTEGER DEFAULT 0,
  checked_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keyword_discovery_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL UNIQUE,
  locations TEXT DEFAULT '',
  menus TEXT DEFAULT '',
  brand_keywords TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  period_type TEXT DEFAULT 'weekly',
  status TEXT DEFAULT 'generated',
  revenue INTEGER DEFAULT 0,
  visitors INTEGER DEFAULT 0,
  place_views INTEGER DEFAULT 0,
  smart_calls INTEGER DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  unit_price INTEGER DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  naver_ad_cost INTEGER DEFAULT 0,
  meta_ad_cost INTEGER DEFAULT 0,
  total_ad_cost INTEGER DEFAULT 0,
  cac INTEGER DEFAULT 0,
  roas REAL DEFAULT 0,
  naver_campaigns_data TEXT DEFAULT '[]',
  meta_campaigns_data TEXT DEFAULT '[]',
  keyword_ranks_data TEXT DEFAULT '[]',
  keyword_top TEXT DEFAULT '[]',
  keyword_rising TEXT DEFAULT '[]',
  keyword_improve TEXT DEFAULT '[]',
  sales_images TEXT DEFAULT '[]',
  summary_points TEXT DEFAULT '',
  channel_analysis TEXT DEFAULT '',
  cac_analysis TEXT DEFAULT '',
  action_plan_keep TEXT DEFAULT '[]',
  action_plan_try TEXT DEFAULT '[]',
  notion_page_url TEXT DEFAULT '',
  exported_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_keyword_date ON rank_records(keyword_id, recorded_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug) WHERE slug IS NOT NULL AND slug != '';

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('meta_cpm', '7000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('meta_cpm_markup', '7000');

-- Default admin (password: admin1234 → SHA-256 hash)
-- 실제 배포 시 wrangler secret 으로 관리 권장
INSERT OR IGNORE INTO users (username, password) VALUES ('admin', 'sha256:e9cee71ab932fde863338d08be4de9dfe39ea049bdafb342ce659ec5450b69ae');
