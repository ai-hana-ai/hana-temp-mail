ALTER TABLE emails ADD COLUMN preview TEXT;
ALTER TABLE emails ADD COLUMN expires_at DATETIME;

UPDATE emails
SET
  preview = CASE
    WHEN trim(coalesce(body_text, '')) != '' THEN substr(trim(body_text), 1, 140)
    ELSE 'No preview available'
  END,
  expires_at = CASE
    WHEN timestamp IS NOT NULL THEN datetime(timestamp, '+7 days')
    ELSE datetime('now', '+7 days')
  END
WHERE preview IS NULL OR expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_emails_expires_at ON emails(expires_at);
