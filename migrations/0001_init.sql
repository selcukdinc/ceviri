-- Çeviri V2 başlangıç şeması

CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan             TEXT NOT NULL DEFAULT 'credits' CHECK (plan IN ('credits', 'unlimited')),
  plan_expires_at  INTEGER,            -- unix ms; NULL = süresiz
  daily_page_cap   INTEGER,            -- NULL = genel ayar kullanılır
  disabled         INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,        -- token'ın SHA-256 özeti
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Bakiye = SUM(delta). Hareketler asla güncellenmez, yalnızca eklenir.
CREATE TABLE credit_ledger (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('grant', 'reserve', 'consume', 'refund', 'adjust')),
  job_id      TEXT,
  note        TEXT,
  actor_id    TEXT,                    -- işlemi yapan admin (varsa)
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_ledger_user ON credit_ledger(user_id, created_at);

CREATE TABLE jobs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  pdf_key          TEXT NOT NULL,
  page_count       INTEGER NOT NULL,
  estimate         INTEGER NOT NULL,   -- rezerve edilen kredi
  charged          INTEGER,            -- kesinleşen kredi
  unlimited        INTEGER NOT NULL DEFAULT 0,
  source_lang      TEXT,
  target_lang      TEXT NOT NULL DEFAULT 'tr',
  status           TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'scanning', 'translating', 'assembling', 'rendering', 'done', 'failed')),
  progress         INTEGER NOT NULL DEFAULT 0,  -- 0..100
  stage_note       TEXT,
  provider         TEXT,
  error            TEXT,
  workflow_id      TEXT,
  created_at       INTEGER NOT NULL,
  finished_at      INTEGER
);
CREATE INDEX idx_jobs_user ON jobs(user_id, created_at);

CREATE TABLE job_pages (
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  page_no     INTEGER NOT NULL,
  weight      REAL NOT NULL,
  has_images  INTEGER NOT NULL DEFAULT 0,
  chars       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, page_no)
);

CREATE TABLE assets (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('page', 'html', 'pdf', 'figures', 'chunk')),
  r2_key      TEXT NOT NULL,
  filename    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_assets_job ON assets(job_id);

CREATE TABLE provider_usage (
  day       TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
  provider  TEXT NOT NULL,
  requests  INTEGER NOT NULL DEFAULT 0,
  failures  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('credit.job_base', '2'),
  ('credit.text_page', '1'),
  ('credit.image_page', '1.5'),
  ('credit.dense_page', '2'),
  ('credit.dense_chars', '3000'),
  ('limits.unlimited_daily_pages', '300'),
  ('limits.max_pages', '400'),
  ('limits.max_mb', '50'),
  ('providers.order', 'gemini,groq,workersai');
