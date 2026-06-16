-- ============================================================
-- [非推奨] 既存Supabaseからの移行用スクリプト
-- 新規構築の場合は 20260602000000_init_multitenant.sql を使用してください
-- ============================================================

-- 1. documents テーブルに tenant_id カラムを追加
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);

-- 2. rag_chunks テーブルに tenant_id カラムを追加
ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant_id ON rag_chunks(tenant_id);

-- 3. match_documents 関数を更新（tenant_id フィルタ対応）
--    既存の関数を置き換える。filter_tenant_id が NULL の場合は全テナントを返す（後方互換）。
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_count      INT      DEFAULT 10,
  match_threshold  FLOAT    DEFAULT 0.0,
  filter_category  TEXT     DEFAULT NULL,
  filter_tenant_id TEXT     DEFAULT NULL
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  source     TEXT,
  source_url TEXT,
  title      TEXT,
  similarity FLOAT,
  tenant_id  TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.source,
    d.source_url,
    d.title,
    1 - (d.embedding <=> query_embedding) AS similarity,
    d.tenant_id
  FROM documents d
  WHERE
    -- tenant_id フィルタ（指定があればそのテナントのみ）
    (filter_tenant_id IS NULL OR d.tenant_id = filter_tenant_id)
    -- category フィルタ（指定があればそのカテゴリのみ）
    AND (filter_category IS NULL OR d.category = filter_category)
    -- 類似度閾値
    AND (match_threshold = 0.0 OR 1 - (d.embedding <=> query_embedding) >= match_threshold)
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
