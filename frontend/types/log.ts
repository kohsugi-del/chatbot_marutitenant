// types/log.ts

export type ChunkStrategy   = "qa_pair" | "semantic" | "table" | "fixed_size";
export type ConversationMode = "normal" | "notice" | "emergency";
export type EscalateType    = "keyword" | "low_confidence" | "manual";
export type ResolvedMethod  = "feedback_positive" | "auto_timeout";
export type MessageRole     = "user" | "assistant";
export type FeedbackValue   = 1 | -1;
export type CategoryTag     = "normal" | "emergency";

// クライアント固有設定
export type ClientConfig = {
  clientId: string;
  categoryPrompt: string;
  emergencyKeywords: string[];
  topicKeywords: { label: string; keywords: string[] }[];
  phoneNumbers: {
    normal: string;
    emergency: string;
  };
  businessHours: string;
};

// チャンク化結果
export type ChunkResult = {
  content: string;
  chunkStrategy: ChunkStrategy;
  category: CategoryTag[];
  sourceUrl: string;
  title: string;
};

// Conversations テーブル
export type Conversation = {
  id: string;
  session_id: string;
  client_id: string;
  category_id: string | null;
  mode: ConversationMode;
  started_at: string;
  ended_at: string | null;
  escalated: boolean;
  escalate_type: EscalateType | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_method: ResolvedMethod | null;
};

// Messages テーブル
export type Message = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  content_length: number | null;
  confidence_score: number | null;
  keyword_matched: string | null;
  retrieved_doc_ids: string[] | null;
  retrieved_doc_titles: string[] | null;
  retrieved_doc_sources: string[] | null;
  unresolved: boolean;
  response_ms: number | null;
  feedback: FeedbackValue | null;
  feedback_at: string | null;
  created_at: string;
};

// /api/chat リクエスト型
export type ChatRequest = {
  session_id: string;
  client_id: string;
  tenant_id?: string;           // マルチテナント: Supabase絞り込み用
  category_id: string | null;
  mode: ConversationMode;
  message: string;
  conversation_id?: string;     // 2回目以降は渡す
};

// /api/chat レスポンス型
export type ChatResponse = {
  message_id: string;
  conversation_id: string;
  answer: string;
  confidence_score: number;
  retrieved_docs: {
    id: string;
    title: string;
    source: string;
  }[];
  escalated: boolean;
  keyword_matched: string | null;
  response_ms: number;
};
