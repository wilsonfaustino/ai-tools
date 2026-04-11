CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'sonnet',
    status TEXT NOT NULL DEFAULT 'active',
    hired_by TEXT NOT NULL,
    hired_date TEXT NOT NULL,
    agent_md_path TEXT NOT NULL,
    capabilities TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    assigned_to TEXT REFERENCES agents(name),
    delegated_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    completed_at TEXT,
    outcome TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    summary TEXT,
    inbox_items_processed TEXT,
    outbox_items_created TEXT
);

CREATE TABLE IF NOT EXISTS hiring_log (
    id INTEGER PRIMARY KEY,
    agent_name TEXT REFERENCES agents(name),
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);
