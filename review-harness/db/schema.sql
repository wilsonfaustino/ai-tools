CREATE TABLE IF NOT EXISTS reviews (
  id              INTEGER PRIMARY KEY,
  pr_number       INTEGER NOT NULL,
  owner           TEXT NOT NULL,
  repo            TEXT NOT NULL,
  branch          TEXT,
  title           TEXT,
  head_sha        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'triaging',
  author          TEXT,
  url             TEXT,
  pr_state        TEXT,
  review_decision TEXT,
  pr_synced_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(owner, repo, pr_number)
);

CREATE TABLE IF NOT EXISTS findings (
  id                   INTEGER PRIMARY KEY,
  review_id            INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  severity             TEXT NOT NULL,
  path                 TEXT NOT NULL,
  line                 INTEGER NOT NULL,
  in_diff              INTEGER NOT NULL DEFAULT 1,
  body                 TEXT NOT NULL,
  decision             TEXT NOT NULL DEFAULT 'pending',
  gh_comment_id        INTEGER,
  posted_at            TEXT,
  addressed_status     TEXT NOT NULL DEFAULT 'open',
  addressed_commit_sha TEXT,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
