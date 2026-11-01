-- Sağlayıcı tanılama: son hata, kota bilgisi ve iş bazlı sağlayıcı günlüğü
ALTER TABLE provider_usage ADD COLUMN last_error TEXT;
ALTER TABLE provider_usage ADD COLUMN last_error_at INTEGER;

CREATE TABLE provider_status (
  provider        TEXT PRIMARY KEY,
  last_ok_at      INTEGER,
  last_error      TEXT,
  last_error_at   INTEGER,
  quota_info      TEXT,           -- ör. Groq'un x-ratelimit-* başlıklarından özet
  quota_info_at   INTEGER,
  rate_limited_until INTEGER      -- 429 sonrası kısa süreli atlama (ms)
);

ALTER TABLE jobs ADD COLUMN provider_log TEXT;  -- JSON dizi: sağlayıcı denemeleri ve hataları
