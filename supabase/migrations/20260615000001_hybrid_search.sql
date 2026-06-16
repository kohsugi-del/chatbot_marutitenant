-- ============================================================
-- Hybrid Search: ベクター検索 + キーワード検索 (RRF統合)
-- Supabase SQL Editorから実行してください
-- ============================================================

-- pg_trgm 拡張を有効化（word_similarity によるキーワード検索に使用）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- documents.content に GIN トリグラムインデックスを追加
-- ILIKE/word_similarity を高速化する
CREATE INDEX IF NOT EXISTS idx_documents_content_trgm
  ON documents USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_content_trgm
  ON rag_chunks USING gin (content gin_trgm_ops);


-- ============================================================
-- hybrid_search_documents 関数
-- ① ベクター検索（意味的類似）と
-- ② キーワード検索（pg_trgm word_similarity による表記一致）を
-- RRF (Reciprocal Rank Fusion) で統合して返す
--
-- rrf_k: RRFの定数 (デフォルト60が標準的)
--   スコア = 1/(k + vector_rank) + 1/(k + keyword_rank)
--   両方にヒットしたドキュメントが上位に来る
-- ============================================================
CREATE OR REPLACE FUNCTION hybrid_search_documents(
  query_embedding  vector(1536),
  query_text       TEXT,
  match_count      INT   DEFAULT 10,
  match_threshold  FLOAT DEFAULT 0.0,
  filter_tenant_id TEXT  DEFAULT NULL,
  filter_category  TEXT  DEFAULT NULL,
  rrf_k            INT   DEFAULT 60
)
RETURNS TABLE (
  id          UUID,
  tenant_id   TEXT,
  content     TEXT,
  source      TEXT,
  source_url  TEXT,
  title       TEXT,
  category    TEXT,
  similarity  FLOAT,
  rrf_score   FLOAT
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  candidate_count INT := match_count * 3;
BEGIN
  RETURN QUERY
  WITH
  -- ① ベクター検索（コサイン類似度の降順で上位を取得）
  vector_results AS (
    SELECT
      d.id,
      (1 - (d.embedding <=> query_embedding))::FLOAT AS vscore,
      ROW_NUMBER() OVER (ORDER BY d.embedding <=> query_embedding)::INT AS vrank
    FROM documents d
    WHERE
      (filter_tenant_id IS NULL OR d.tenant_id = filter_tenant_id)
      AND (filter_category IS NULL OR d.category = filter_category)
      AND (match_threshold = 0.0 OR 1 - (d.embedding <=> query_embedding) >= match_threshold)
    ORDER BY d.embedding <=> query_embedding
    LIMIT candidate_count
  ),

  -- ② キーワード検索（word_similarity: クエリ文字列がcontentに部分的に含まれる度合い）
  -- 固有名詞・品番・サービス名など意味検索が苦手な完全一致系に強い
  -- 閾値0.1は広め（日本語テキストへの寛容な対応）
  keyword_results AS (
    SELECT
      d.id,
      ROW_NUMBER() OVER (ORDER BY word_similarity(query_text, d.content) DESC)::INT AS krank
    FROM documents d
    WHERE
      (filter_tenant_id IS NULL OR d.tenant_id = filter_tenant_id)
      AND (filter_category IS NULL OR d.category = filter_category)
      AND word_similarity(query_text, d.content) > 0.1
    ORDER BY word_similarity(query_text, d.content) DESC
    LIMIT candidate_count
  ),

  -- ③ RRF統合
  -- 両方にヒットしたドキュメントはスコアが加算されて上位に浮上する
  -- 1.0::FLOAT で numeric → double precision を明示（PostgreSQL型一致のため）
  merged AS (
    SELECT
      COALESCE(v.id, k.id)                                                          AS doc_id,
      COALESCE(v.vscore, 0.0::FLOAT)                                                AS vscore,
      (COALESCE(1.0::FLOAT / (rrf_k + v.vrank), 0.0::FLOAT)
        + COALESCE(1.0::FLOAT / (rrf_k + k.krank), 0.0::FLOAT))::FLOAT            AS rrf_score
    FROM vector_results v
    FULL OUTER JOIN keyword_results k ON v.id = k.id
  )

  SELECT
    d.id,
    d.tenant_id,
    d.content,
    d.source,
    d.source_url,
    d.title,
    d.category,
    m.vscore    AS similarity,   -- 信頼度スコア用（ベクター類似度）
    m.rrf_score                  -- ランキング用（RRF統合スコア）
  FROM merged m
  JOIN documents d ON m.doc_id = d.id
  ORDER BY m.rrf_score DESC
  LIMIT match_count;
END;
$$;
