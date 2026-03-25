-- Migration: add a covering inbox lookup index for ordered mailbox queries

CREATE INDEX IF NOT EXISTS idx_emails_to_timestamp_id
ON emails(id_to, timestamp DESC, id DESC);
