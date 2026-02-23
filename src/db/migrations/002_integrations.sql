-- ============================================================
-- MIGRATION 002: Platform Integrations
-- Social platform + website chat channel support
-- ============================================================

-- Platform integration configuration per tenant
CREATE TABLE platform_integrations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    platform        VARCHAR(63) NOT NULL,          -- discord|slack|telegram|teams|whatsapp|web
    name            VARCHAR(255) NOT NULL,
    config          JSONB NOT NULL DEFAULT '{}',   -- platform-specific keys (encrypted at rest)
    bot_user_id     UUID REFERENCES users(id),     -- service account for this integration
    enabled         BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, platform, name)
);

CREATE INDEX idx_platform_integrations_tenant ON platform_integrations(tenant_id, platform) WHERE enabled = true;

-- Map external platform user IDs → internal user IDs
CREATE TABLE integration_user_map (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id      UUID NOT NULL REFERENCES platform_integrations(id) ON DELETE CASCADE,
    external_user_id    VARCHAR(511) NOT NULL,
    internal_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(integration_id, external_user_id)
);

CREATE INDEX idx_integration_user_map ON integration_user_map(integration_id, external_user_id);

-- Map external platform conversation/channel IDs → internal conversation IDs
CREATE TABLE integration_conversation_map (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id      UUID NOT NULL REFERENCES platform_integrations(id) ON DELETE CASCADE,
    external_conv_id    VARCHAR(511) NOT NULL,
    internal_conv_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(integration_id, external_conv_id)
);

CREATE INDEX idx_integration_conv_map ON integration_conversation_map(integration_id, external_conv_id);

-- Audit incoming integration events
CREATE TABLE integration_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id  UUID NOT NULL REFERENCES platform_integrations(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL,
    platform        VARCHAR(63) NOT NULL,
    event_type      VARCHAR(127),                  -- message|command|reaction|etc.
    external_event_id VARCHAR(511),                -- platform-native event/message ID
    payload         JSONB DEFAULT '{}',            -- raw incoming payload (sanitised)
    processed       BOOLEAN DEFAULT false,
    error           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_integration_events_integration ON integration_events(integration_id, created_at DESC);
