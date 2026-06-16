-- ============================================================
-- RAGチャットボット マルチテナント対応 完全初期スキーマ
-- 新規Supabaseプロジェクトに対してSupabase SQL Editorから実行する
-- ============================================================

-- pgvector拡張を有効化
CREATE EXTENSION IF NOT EXISTS vector;


-- ============================================================
-- documents テーブル（RAGナレッジストア・Webクロール）
-- tenant_id: バックエンドの tenants テーブルの id（UUID文字列）
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT    NOT NULL,                         -- テナント識別子（必須）
  site_id         INTEGER,                                  -- サイト管理DBのsite_id
  url             TEXT,
  chunk_index     INTEGER DEFAULT 0,
  content         TEXT    NOT NULL,
  embedding       vector(1536),
  source          TEXT,
  source_url      TEXT,
  title           TEXT,
  category        TEXT,                                     -- "emergency" / NULL
  chunk_strategy  TEXT,
  updated_at      TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- upsert用ユニーク制約（同一テナント・サイト内で重複しない）
ALTER TABLE documents
  ADD CONSTRAINT documents_tenant_site_url_chunk_key
  UNIQUE (tenant_id, site_id, url, chunk_index);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id
  ON documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_site
  ON documents (tenant_id, site_id);
CREATE INDEX IF NOT EXISTS idx_documents_embedding
  ON documents USING hnsw (embedding vector_cosine_ops);


-- ============================================================
-- rag_chunks テーブル（PDFチャンク）
-- ============================================================
CREATE TABLE IF NOT EXISTS rag_chunks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  TEXT NOT NULL,                                -- テナント識別子（必須）
  content    TEXT NOT NULL,
  embedding  vector(1536),
  file_id    INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant_id
  ON rag_chunks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
  ON rag_chunks USING hnsw (embedding vector_cosine_ops);


-- ============================================================
-- match_documents 関数（ベクター類似検索 + テナントフィルタ）
-- filter_tenant_id が指定された場合、そのテナントのドキュメントのみ返す
-- ============================================================
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding  vector(1536),
  match_count      INT   DEFAULT 10,
  match_threshold  FLOAT DEFAULT 0.0,
  filter_tenant_id TEXT  DEFAULT NULL,
  filter_category  TEXT  DEFAULT NULL
)
RETURNS TABLE (
  id          UUID,
  tenant_id   TEXT,
  content     TEXT,
  source      TEXT,
  source_url  TEXT,
  title       TEXT,
  category    TEXT,
  similarity  FLOAT
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.tenant_id,
    d.content,
    d.source,
    d.source_url,
    d.title,
    d.category,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE
    (filter_tenant_id IS NULL OR d.tenant_id = filter_tenant_id)
    AND (filter_category IS NULL OR d.category = filter_category)
    AND (match_threshold = 0.0 OR 1 - (d.embedding <=> query_embedding) >= match_threshold)
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- ============================================================
-- match_rag_chunks 関数（PDF検索 + テナントフィルタ）
-- ============================================================
CREATE OR REPLACE FUNCTION match_rag_chunks(
  query_embedding  vector(1536),
  match_count      INT   DEFAULT 5,
  match_threshold  FLOAT DEFAULT 0.0,
  filter_tenant_id TEXT  DEFAULT NULL
)
RETURNS TABLE (
  id         UUID,
  tenant_id  TEXT,
  content    TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.tenant_id,
    r.content,
    1 - (r.embedding <=> query_embedding) AS similarity
  FROM rag_chunks r
  WHERE
    (filter_tenant_id IS NULL OR r.tenant_id = filter_tenant_id)
    AND (match_threshold = 0.0 OR 1 - (r.embedding <=> query_embedding) >= match_threshold)
  ORDER BY r.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


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
-- client_id: フロントエンドのクライアントスラッグ（例: "asahikawa-gas"）
-- tenant_id: バックエンドのテナントUUID（documentsと同じ識別子）
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       TEXT NOT NULL,
  client_id        TEXT NOT NULL,                          -- フロントのスラッグ
  tenant_id        TEXT,                                   -- バックエンドUUID
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

CREATE INDEX IF NOT EXISTS idx_conversations_client_id
  ON conversations (client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_id
  ON conversations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_started_at
  ON conversations (started_at);
CREATE INDEX IF NOT EXISTS idx_conversations_client_started
  ON conversations (client_id, started_at);
CREATE INDEX IF NOT EXISTS idx_conversations_escalated
  ON conversations (client_id, escalated) WHERE escalated = TRUE;
CREATE INDEX IF NOT EXISTS idx_conversations_resolved
  ON conversations (client_id, resolved) WHERE resolved = TRUE;


-- ============================================================
-- messages テーブル（発言単位ログ）
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role                  TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content               TEXT    NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at      ON messages (created_at);
CREATE INDEX IF NOT EXISTS idx_messages_keyword
  ON messages (keyword_matched) WHERE keyword_matched IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_feedback
  ON messages (feedback) WHERE feedback IS NOT NULL;


-- ============================================================
-- RLS（Row Level Security）
-- SERVICE_ROLE キーはバイパスされるのでバックエンドは影響なし
-- フロントから直接Supabaseにアクセスする場合に適用
-- ============================================================
ALTER TABLE documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;

-- documents: tenant_id が一致するもののみ読み取り可
DROP POLICY IF EXISTS "tenant_isolation_documents" ON documents;
CREATE POLICY "tenant_isolation_documents"
  ON documents FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', TRUE));

-- rag_chunks: tenant_id が一致するもののみ読み取り可
DROP POLICY IF EXISTS "tenant_isolation_rag_chunks" ON rag_chunks;
CREATE POLICY "tenant_isolation_rag_chunks"
  ON rag_chunks FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', TRUE));

-- conversations: client_id が一致するもののみ読み取り可
DROP POLICY IF EXISTS "client_isolation_conversations" ON conversations;
CREATE POLICY "client_isolation_conversations"
  ON conversations FOR SELECT
  USING (client_id = current_setting('app.client_id', TRUE));

-- messages: 対応する conversations のみ
DROP POLICY IF EXISTS "client_isolation_messages" ON messages;
CREATE POLICY "client_isolation_messages"
  ON messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE client_id = current_setting('app.client_id', TRUE)
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
-- DROP FUNCTION IF EXISTS match_documents;
-- DROP FUNCTION IF EXISTS match_rag_chunks;
-- ============================================================
