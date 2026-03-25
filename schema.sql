CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  id_to TEXT,
  id_from TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  preview TEXT,
  expires_at DATETIME DEFAULT (datetime('now', '+7 days')),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_emails_to ON emails(id_to);
CREATE INDEX IF NOT EXISTS idx_emails_to_timestamp_id ON emails(id_to, timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_emails_expires_at ON emails(expires_at);
