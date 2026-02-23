-- ============================================================
-- SUPREME ENTERPRISE CHATBOT PLATFORM — INITIAL SCHEMA
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- TENANT & CONFIGURATION
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(63) UNIQUE NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    region          VARCHAR(31) NOT NULL,
    tier            VARCHAR(31) DEFAULT 'standard',
    deployment_mode VARCHAR(31) DEFAULT 'saas',
    status          VARCHAR(31) DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    version         INTEGER NOT NULL,
    config_yaml     JSONB NOT NULL,
    is_active       BOOLEAN DEFAULT false,
    published_at    TIMESTAMPTZ,
    published_by    UUID,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, version)
);

CREATE INDEX IF NOT EXISTS idx_tenant_configs_active ON tenant_configs(tenant_id) WHERE is_active = true;

-- ============================================================
-- USERS & ACCESS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    external_id     VARCHAR(255),
    email           VARCHAR(255),
    display_name    VARCHAR(255),
    role            VARCHAR(63) DEFAULT 'user',
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, external_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    key_hash        VARCHAR(255) NOT NULL,
    name            VARCHAR(255),
    scopes          TEXT[] DEFAULT '{}',
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CONVERSATIONS & MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    channel         VARCHAR(63) DEFAULT 'web',
    status          VARCHAR(31) DEFAULT 'active',
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    tenant_id       UUID NOT NULL,
    role            VARCHAR(31) NOT NULL,
    content         TEXT,
    tool_calls      JSONB,
    citations       JSONB,
    model_used      VARCHAR(127),
    token_count_in  INTEGER,
    token_count_out INTEGER,
    latency_ms      INTEGER,
    safety_flags    JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS messages_2025_01 PARTITION OF messages
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE IF NOT EXISTS messages_2025_02 PARTITION OF messages
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE IF NOT EXISTS messages_2025_03 PARTITION OF messages
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE IF NOT EXISTS messages_2025_04 PARTITION OF messages
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE IF NOT EXISTS messages_2025_05 PARTITION OF messages
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE IF NOT EXISTS messages_2025_06 PARTITION OF messages
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS messages_2025_07 PARTITION OF messages
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE IF NOT EXISTS messages_2025_08 PARTITION OF messages
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE IF NOT EXISTS messages_2025_09 PARTITION OF messages
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE IF NOT EXISTS messages_2025_10 PARTITION OF messages
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE IF NOT EXISTS messages_2025_11 PARTITION OF messages
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE IF NOT EXISTS messages_2025_12 PARTITION OF messages
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS messages_2026_01 PARTITION OF messages
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS messages_2026_02 PARTITION OF messages
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS messages_2026_03 PARTITION OF messages
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS messages_2026_04 PARTITION OF messages
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS messages_2026_05 PARTITION OF messages
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS messages_2026_06 PARTITION OF messages
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS messages_2026_07 PARTITION OF messages
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS messages_2026_08 PARTITION OF messages
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS messages_2026_09 PARTITION OF messages
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS messages_2026_10 PARTITION OF messages
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS messages_2026_11 PARTITION OF messages
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS messages_2026_12 PARTITION OF messages
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- ============================================================
-- MEMORY
-- ============================================================
CREATE TABLE IF NOT EXISTS user_memory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    user_id         UUID NOT NULL REFERENCES users(id),
    category        VARCHAR(63) NOT NULL,
    key             VARCHAR(255) NOT NULL,
    value           TEXT NOT NULL,
    consent_given   BOOLEAN DEFAULT true,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, user_id, category, key)
);

-- ============================================================
-- KNOWLEDGE SOURCES
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255) NOT NULL,
    source_type     VARCHAR(63) NOT NULL,
    connection_config JSONB NOT NULL,
    acl_mode        VARCHAR(31) DEFAULT 'rbac',
    sync_schedule   VARCHAR(63) DEFAULT '0 */4 * * *',
    status          VARCHAR(31) DEFAULT 'active',
    last_synced_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    source_id       UUID NOT NULL REFERENCES knowledge_sources(id),
    external_id     VARCHAR(511),
    title           VARCHAR(1023),
    url             VARCHAR(2047),
    content_hash    VARCHAR(127),
    chunk_count     INTEGER DEFAULT 0,
    sensitivity     VARCHAR(31) DEFAULT 'internal',
    acl_groups      TEXT[] DEFAULT '{}',
    metadata        JSONB DEFAULT '{}',
    indexed_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL REFERENCES documents(id),
    tenant_id       UUID NOT NULL,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    token_count     INTEGER,
    embedding       vector(1536),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON document_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- TOOLS & CONNECTORS
-- ============================================================
CREATE TABLE IF NOT EXISTS tools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255),
    description     TEXT,
    input_schema    JSONB NOT NULL,
    output_schema   JSONB,
    endpoint_config JSONB NOT NULL,
    risk_level      VARCHAR(31) DEFAULT 'low',
    requires_confirm BOOLEAN DEFAULT false,
    rate_limit      INTEGER DEFAULT 10,
    enabled         BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tool_executions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    conversation_id UUID NOT NULL,
    message_id      UUID,
    tool_id         UUID NOT NULL REFERENCES tools(id),
    user_id         UUID NOT NULL,
    input_args      JSONB,
    output_result   JSONB,
    status          VARCHAR(31),
    confirmed_by    UUID,
    latency_ms      INTEGER,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    actor_id        UUID,
    actor_type      VARCHAR(31),
    action          VARCHAR(127) NOT NULL,
    resource_type   VARCHAR(63),
    resource_id     UUID,
    detail          JSONB DEFAULT '{}',
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS audit_logs_2025 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS audit_logs_2027 PARTITION OF audit_logs
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- ============================================================
-- EVALUATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS eval_suites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(63),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_cases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id        UUID NOT NULL REFERENCES eval_suites(id),
    input_messages  JSONB NOT NULL,
    expected_output TEXT,
    tags            TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id        UUID NOT NULL REFERENCES eval_suites(id),
    model_config    JSONB,
    results_summary JSONB,
    status          VARCHAR(31),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);
