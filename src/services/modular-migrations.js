import {brainPool,pool} from '../db.js';
export async function migrateModularFeatures(){
  await brainPool.query(`
    ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS content_hash TEXT;
    ALTER TABLE ai_rules ADD COLUMN IF NOT EXISTS intent TEXT NOT NULL DEFAULT 'GENERAL';
    ALTER TABLE ai_rules ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE ai_rules ADD COLUMN IF NOT EXISTS action JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE ai_rules ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100;
    ALTER TABLE ai_rules ADD COLUMN IF NOT EXISTS stop_processing BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE ai_rules ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE ai_rules ADD COLUMN IF NOT EXISTS content_hash TEXT;
    ALTER TABLE bot_important_info ADD COLUMN IF NOT EXISTS content_hash TEXT;
    ALTER TABLE bot_promo_rules ADD COLUMN IF NOT EXISTS content_hash TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_content_hash ON knowledge_base(content_hash) WHERE content_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rules_content_hash ON ai_rules(content_hash) WHERE content_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_important_content_hash ON bot_important_info(content_hash) WHERE content_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_supplies_content_hash ON bot_promo_rules(content_hash) WHERE content_hash IS NOT NULL;
    CREATE TABLE IF NOT EXISTS bot_manual_responses(
      id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,intent TEXT NOT NULL DEFAULT 'GENERAL',trigger_text TEXT,
      response_text TEXT NOT NULL,priority INT NOT NULL DEFAULT 100,enabled BOOLEAN NOT NULL DEFAULT true,notes TEXT,
      content_hash TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_bot_manual_responses_retrieval ON bot_manual_responses(enabled,intent,priority DESC,updated_at DESC);
  `);
  await pool.query(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handling_state TEXT NOT NULL DEFAULT 'AI_ACTIVE';
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_handling_state_check;
    ALTER TABLE conversations ADD CONSTRAINT conversations_handling_state_check CHECK (handling_state IN ('AI_ACTIVE','HUMAN_TAKEOVER','WAITING_TELEGRAM','PROCESSING','CLOSED'));
    CREATE INDEX IF NOT EXISTS idx_conversations_active_state ON conversations(visible_in_inbox,handling_state,last_event_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_inbox_order ON conversations(visible_in_inbox,lc_inbox_rank, last_event_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id_desc ON messages(chat_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_human_requests_status_updated ON human_requests(status,updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bridge_tickets_status_updated ON human_bridge_tickets(status,updated_at DESC);
    CREATE TABLE IF NOT EXISTS content_collection_meta(
      collection_type TEXT PRIMARY KEY,version BIGINT NOT NULL DEFAULT 1,record_count BIGINT NOT NULL DEFAULT 0,
      checksum TEXT,last_updated TIMESTAMPTZ,last_synced TIMESTAMPTZ,source TEXT NOT NULL DEFAULT 'database'
    );
    CREATE TABLE IF NOT EXISTS content_import_history(
      id BIGSERIAL PRIMARY KEY,collection_type TEXT NOT NULL,file_name TEXT,uploaded INT NOT NULL DEFAULT 0,
      added INT NOT NULL DEFAULT 0,duplicate_skipped INT NOT NULL DEFAULT 0,invalid INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS logic_conflicts(
      id BIGSERIAL PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,source_a TEXT NOT NULL,source_a_id TEXT,
      source_b TEXT NOT NULL,source_b_id TEXT,reason TEXT NOT NULL,severity TEXT NOT NULL,recommendation TEXT,
      status TEXT NOT NULL DEFAULT 'UNRESOLVED',detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),resolved_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS admin_audit_log(
      id BIGSERIAL PRIMARY KEY,actor TEXT NOT NULL DEFAULT 'admin',action TEXT NOT NULL,resource TEXT,
      resource_id TEXT,request_id TEXT,meta JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
