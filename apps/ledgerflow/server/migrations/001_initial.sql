CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  storage_quota_bytes BIGINT NOT NULL CHECK (storage_quota_bytes > 0),
  storage_used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
  storage_reserved_bytes BIGINT NOT NULL DEFAULT 0 CHECK (storage_reserved_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_uid VARCHAR(128) NOT NULL,
  role VARCHAR(24) NOT NULL CHECK (role IN ('owner', 'admin', 'accountant', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_uid)
);

CREATE INDEX IF NOT EXISTS workspace_memberships_user_idx ON workspace_memberships (user_uid, workspace_id);

CREATE TABLE IF NOT EXISTS cloud_documents (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by VARCHAR(128) NOT NULL,
  file_name VARCHAR(180) NOT NULL,
  content_type VARCHAR(100) NOT NULL CHECK (content_type IN ('application/pdf', 'application/xml', 'text/xml')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  object_key TEXT NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('uploading', 'uploaded', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cloud_documents_workspace_idx ON cloud_documents (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id UUID REFERENCES cloud_documents(id) ON DELETE SET NULL,
  invoice_number VARCHAR(120) NOT NULL,
  supplier VARCHAR(240) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE,
  amount NUMERIC(18, 2) NOT NULL,
  vat_amount NUMERIC(18, 2),
  currency CHAR(3) NOT NULL,
  account_code VARCHAR(32),
  status VARCHAR(24) NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review', 'approved', 'rejected')),
  created_by VARCHAR(128) NOT NULL,
  reviewed_by VARCHAR(128),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoices_workspace_idx ON invoices (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_workspace_number_idx ON invoices (workspace_id, invoice_number);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_uid VARCHAR(128) NOT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_workspace_idx ON audit_events (workspace_id, created_at DESC);