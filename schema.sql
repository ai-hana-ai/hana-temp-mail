CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  id_to TEXT,
  id_from TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_emails_to ON emails(id_to);
