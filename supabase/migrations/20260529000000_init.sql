-- ============================================================
-- [非推奨] シングルテナント用 初期スキーマ
-- 新規構築の場合は 20260602000000_init_multitenant.sql を使用してください
-- ============================================================

-- pgvector拡張を有効化
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- documents テーブル（RAGナレッジストア）
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         INTEGER,
  url             TEXT,
  chunk_index     INTEGER DEFAULT 0,
  content         TEXT NOT NULL,
  embedding       vector(1536),
  source          TEXT,
  title           TEXT,
  category        TEXT[],
  source_url      TEXT,
  last_crawled_at TIMESTAMP WITH TIME ZONE,
  chunk_strategy  TEXT,
  updated_at      TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 既存テーブルへの列追加（初回実行時はスキップされる）
ALTER TABLE documents ADD COLUMN IF NOT EXISTS site_id     INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS url         TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_index INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMP WITH TIME ZONE;

-- upsert用ユニーク制約
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_site_url_chunk_key'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_site_url_chunk_key UNIQUE (site_id, url, chunk_index);
  END IF;
END$$;

-- ベクター類似検索RPC（categoryフィルタ対応）
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding  vector(1536),
  match_count      INT     DEFAULT 5,
  match_threshold  FLOAT   DEFAULT 0.0,
  filter_category  TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id             UUID,
  content        TEXT,
  source         TEXT,
  title          TEXT,
  category       TEXT[],
  chunk_strategy TEXT,
  similarity     FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    d.id,
    d.content,
    d.source,
    d.title,
    d.category,
    d.chunk_strategy,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE 1 - (d.embedding <=> query_embedding) > match_threshold
    AND (filter_category IS NULL OR filter_category = ANY(d.category))
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- hnswインデックス
CREATE INDEX IF NOT EXISTS idx_documents_embedding
  ON documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_documents_site_url
  ON documents (site_id, url);

-- ============================================================
-- rag_chunks テーブル（PDFチャンク）
-- ============================================================
CREATE TABLE IF NOT EXISTS rag_chunks (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content   TEXT NOT NULL,
  embedding vector(1536),
  file_id   INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PDF用ベクター検索RPC
CREATE OR REPLACE FUNCTION match_rag_chunks (
  query_embedding  vector(1536),
  match_count      INT   DEFAULT 5,
  match_threshold  FLOAT DEFAULT 0.0
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    r.id,
    r.content,
    1 - (r.embedding <=> query_embedding) AS similarity
  FROM rag_chunks r
  WHERE 1 - (r.embedding <=> query_embedding) > match_threshold
  ORDER BY r.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
  ON rag_chunks USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- ingest_state テーブル（クロール進捗管理）
-- ============================================================
CREATE TABLE IF NOT EXISTS ingest_state (
  site_id    INTEGER PRIMARY KEY,
  cursor     INTEGER DEFAULT 0,
  total      INTEGER DEFAULT 0,
  status     TEXT    DEFAULT 'idle',
  last_url   TEXT,
  last_error TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- page_fingerprints テーブル（重複クロール防止）
-- ============================================================
CREATE TABLE IF NOT EXISTS page_fingerprints (
  site_id    INTEGER NOT NULL,
  url        TEXT    NOT NULL,
  page_hash  TEXT    NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (site_id, url)
);

-- ============================================================
-- conversations テーブル（会話セッション単位ログ）
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       TEXT NOT NULL,
  client_id        TEXT NOT NULL,
  category_id      TEXT,
  mode             TEXT NOT NULL DEFAULT 'normal',
  started_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at         TIMESTAMP WITH TIME ZONE,
  escalated        BOOLEAN DEFAULT FALSE,
  escalate_type    TEXT,
  resolved         BOOLEAN DEFAULT FALSE,
  resolved_at      TIMESTAMP WITH TIME ZONE,
  resolved_method  TEXT
);

-- ============================================================
-- messages テーブル（発言単位ログ）
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role                  TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content               TEXT NOT NULL,
  content_length        INTEGER,
  confidence_score      FLOAT,
  keyword_matched       TEXT,
  retrieved_doc_ids     UUID[],
  retrieved_doc_titles  TEXT[],
  retrieved_doc_sources TEXT[],
  unresolved            BOOLEAN DEFAULT FALSE,
  response_ms           INTEGER,
  feedback              SMALLINT CHECK (feedback IN (-1, 1)),
  feedback_at           TIMESTAMP WITH TIME ZONE,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- インデックス
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_conversations_client_id      ON conversations (client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_started_at     ON conversations (started_at);
CREATE INDEX IF NOT EXISTS idx_conversations_client_started ON conversations (client_id, started_at);
CREATE INDEX IF NOT EXISTS idx_conversations_escalated      ON conversations (client_id, escalated) WHERE escalated = TRUE;
CREATE INDEX IF NOT EXISTS idx_conversations_resolved       ON conversations (client_id, resolved)   WHERE resolved = TRUE;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at      ON messages (created_at);
CREATE INDEX IF NOT EXISTS idx_messages_role            ON messages (role);
CREATE INDEX IF NOT EXISTS idx_messages_keyword         ON messages (keyword_matched) WHERE keyword_matched IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_feedback        ON messages (feedback)        WHERE feedback IS NOT NULL;

-- ============================================================
-- RLS（サービスロールキーはバイパス、フロントから直接アクセス時に適用）
-- ============================================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_isolation_conversations" ON conversations;
CREATE POLICY "client_isolation_conversations"
  ON conversations FOR SELECT
  USING (client_id = current_setting('app.client_id'));

DROP POLICY IF EXISTS "client_isolation_messages" ON messages;
CREATE POLICY "client_isolation_messages"
  ON messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE client_id = current_setting('app.client_id')
    )
  );

-- ============================================================
-- ロールバック手順（問題発生時のみ実行）
-- DROP TABLE IF EXISTS messages CASCADE;
-- DROP TABLE IF EXISTS conversations CASCADE;
-- DROP TABLE IF EXISTS page_fingerprints CASCADE;
-- DROP TABLE IF EXISTS ingest_state CASCADE;
-- DROP TABLE IF EXISTS rag_chunks CASCADE;
-- DROP TABLE IF EXISTS documents CASCADE;
-- ============================================================
