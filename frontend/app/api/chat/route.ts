// app/api/chat/route.ts
// 埋め込み: OpenAI text-embedding-3-small
// 回答生成: Claude claude-sonnet-4-6
// テナント: NEXT_PUBLIC_CLIENT_ID 環境変数で切替（デフォルト: default）

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import {
  startConversation,
  logUserMessage,
  logAssistantMessage,
  escalateConversation,
} from "@/lib/log";
import { getClientConfig } from "@/lib/getClientConfig";
import type { ConversationMode, ClientConfig, ChatRequest, ChatResponse } from "@/types/log";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function mustEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`${name} is missing`);
  return v;
}

type ClientMsg = { role: "user" | "assistant"; content: string };

// リクエストボディ（後方互換のため既存フィールドも残す）
type ChatBody = Partial<ChatRequest> & {
  question?: string;
  message?: string;
  top_k?: number;
  messages?: ClientMsg[];
};

// ---- OpenAI（埋め込みのみ）----
const openai = new OpenAI({ apiKey: mustEnv("OPENAI_API_KEY") });

// ---- Anthropic（回答生成・Reranker・Reflection）----
const anthropic = new Anthropic({ apiKey: mustEnv("ANTHROPIC_API_KEY") });

// ---- Google Gemini（Query Rewrite・Context Compression）----
const GEMINI_API_KEY = env("GOOGLE_GENERATIVE_AI_API_KEY") ?? "";
const geminiAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
// gemini-2.5-flash: 精度重視・Thinking無効化（Edge Runtime対応）
const GEMINI_MODEL = "gemini-2.5-flash";

async function geminiComplete(system: string, user: string, maxTokens = 1024): Promise<string> {
  if (!geminiAI) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
  const model = geminiAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: system,
  });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      // @ts-expect-error thinkingConfig is supported by gemini-2.5-flash but not yet typed in SDK 0.24.x
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  return result.response.text();
}

// ---- Supabase（ベクター検索）----
const SUPABASE_URL = env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL") ?? "";
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is missing");

const SUPABASE_KEY =
  env("SUPABASE_SERVER_KEY") ??
  env("SUPABASE_SERVICE_ROLE_KEY") ??
  env("SUPABASE_ANON_KEY") ??
  env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
  "";
if (!SUPABASE_KEY) throw new Error("SUPABASE key is missing");

console.log("[debug] SUPABASE_URL:", SUPABASE_URL);
console.log("[debug] SUPABASE_KEY prefix:", SUPABASE_KEY.slice(0, 30));

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const RPC_NAME = env("SUPABASE_MATCH_RPC") ?? "hybrid_search_documents";
const MATCH_THRESHOLD = Number(env("SUPABASE_MATCH_THRESHOLD") ?? "0");

// ============================================================
// RAGコア（埋め込み・検索）
// ============================================================

const RERANKER_MODEL = "claude-haiku-4-5-20251001";
const RERANKER_TOP_N = Number(env("RERANKER_TOP_N") ?? "5");

async function embedQuery(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding as unknown as number[];
}

type Retrieved = {
  id: string;
  text: string;
  source: string;
  title: string;
  similarity: number;
};

// Hybrid Search: ベクター検索 + キーワード検索 (RRF統合)
async function searchSupabase(
  query: string,
  topK: number,
  mode: ConversationMode,
  tenantId?: string
): Promise<Retrieved[]> {
  const qEmb = await embedQuery(query);

  const args: Record<string, unknown> = {
    query_embedding: qEmb,
    query_text: query,
    match_count: topK,
  };
  if (MATCH_THRESHOLD > 0) args.match_threshold = MATCH_THRESHOLD;

  if (tenantId) {
    args.filter_tenant_id = tenantId;
  }

  // emergencyモードは緊急カテゴリのドキュメントのみ検索
  if (mode === "emergency") {
    args.filter_category = "emergency";
  }

  const { data, error } = await supabase.rpc(RPC_NAME, args);
  if (error) throw new Error(`supabase.rpc(${RPC_NAME}) failed: ${error.message}`);

  const rows = (data ?? []) as Record<string, unknown>[];
  return rows
    .map((row) => {
      const text = String(
        row.content ?? row.text ?? row.chunk ?? row.body ?? ""
      ).trim();
      const source = String(
        row.source ?? row.url ?? row.source_url ?? row.path ?? ""
      ).trim();
      const title = String(row.title ?? source).trim();
      const id = String(row.id ?? "");
      const similarity = Number(row.similarity ?? row.score ?? 0);
      return { id, text, source, title, similarity };
    })
    .filter((r) => r.text.length > 0);
}

// ============================================================
// Reranker（Claude Haikuによる関連度再評価）
// ============================================================

async function rerankDocuments(
  query: string,
  docs: Retrieved[],
  topN: number
): Promise<{ docs: Retrieved[]; scores: number[] }> {
  if (docs.length <= 1) {
    return { docs: docs.slice(0, topN), scores: docs.map(() => 10) };
  }

  const docList = docs
    .map((d, i) => `[${i + 1}] ${d.text.slice(0, 400)}`)
    .join("\n\n---\n\n");

  const prompt = `ユーザーの質問に対して、各ドキュメントの関連度を0〜10で評価してください。

質問: ${query}

ドキュメント一覧:
${docList}

JSONのみを返してください（説明不要）:
{"scores": [{"index": 1, "score": 8}, {"index": 2, "score": 3}, ...]}`;

  try {
    const res = await anthropic.messages.create({
      model: RERANKER_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = res.content[0]?.type === "text" ? res.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { docs: docs.slice(0, topN), scores: [] };

    const { scores } = JSON.parse(jsonMatch[0]) as {
      scores: { index: number; score: number }[];
    };
    const scoreMap = new Map(scores.map((s) => [s.index - 1, s.score]));

    const ranked = docs
      .map((d, i) => ({ doc: d, rerankScore: scoreMap.get(i) ?? 0 }))
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, topN);

    return {
      docs: ranked.map((x) => x.doc),
      scores: ranked.map((x) => x.rerankScore),
    };
  } catch {
    // Reranker失敗時はHybrid Searchの順序をそのまま使う
    return { docs: docs.slice(0, topN), scores: [] };
  }
}

function lastUserFromHistory(body: ChatBody): string {
  const direct = String(body.message ?? body.question ?? "").trim();
  if (direct) return direct;
  if (Array.isArray(body.messages) && body.messages.length) {
    const lastUser = [...body.messages].reverse().find((m) => m?.role === "user");
    return String(lastUser?.content ?? "").trim();
  }
  return "";
}

function normalizeHistory(body: ChatBody, maxTurns = 60): ClientMsg[] {
  const raw = Array.isArray(body.messages) ? body.messages : [];
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content ?? "").slice(0, 4000) }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-maxTurns);
}

// ============================================================
// テナントシステムプロンプト取得（バックエンドAPI）
// ============================================================

async function fetchTenantSystemPrompt(tenantId: string): Promise<string | null> {
  const apiBase = env("NEXT_PUBLIC_API_BASE") ?? "http://localhost:8000";
  const adminSecret = env("ADMIN_SECRET") ?? "";
  if (!adminSecret) return null;
  try {
    const res = await fetch(`${apiBase}/tenants/${tenantId}`, {
      headers: { "X-Admin-Secret": adminSecret },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const tenant = await res.json() as { system_prompt?: string };
    return tenant.system_prompt ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// システムプロンプト生成（クライアント設定・モード対応）
// ============================================================

function buildSystemPrompt(
  categoryId: string | null,
  mode: ConversationMode,
  config: ClientConfig,
  tenantSystemPrompt?: string | null
): string {
  const base = tenantSystemPrompt
    ? tenantSystemPrompt
    : `あなたは${config.clientId}のカスタマーサポートAIです。
提供された資料をもとに回答してください。
資料に根拠がない場合は「詳しくはサービスの公式サイトをご確認いただくか、直接お問い合わせください」と案内してください。

【回答形式の注意】
- マークダウン記法（##、**、---、|テーブル|など）は使わないでください
- 絵文字は使わないでください
- 箇条書きは「・」を使ってください
- 自然な日本語の文章で回答してください`;

  const categoryContext = categoryId
    ? `\nこのユーザーは「${categoryId}」に関心があります。`
    : "";

  const emergencyContext =
    mode === "emergency"
      ? `\n\n【緊急事態対応モード】
現在、緊急事態が発生している可能性があります。
避難・安全確保に関する情報を最優先で案内してください。
緊急連絡先：${config.phoneNumbers.emergency}（24時間対応）`
      : mode === "notice"
      ? `\n\n【注意報モード】
現在、注意報が発令されています。
通常の案内に加え、安全に関する情報も合わせて案内してください。`
      : "";

  return base + categoryContext + emergencyContext;
}

// ============================================================
// Query Rewrite（曖昧なクエリを複数の検索クエリに展開）
// ============================================================

async function queryRewrite(query: string): Promise<string[]> {
  const system = `あなたは検索クエリ最適化の専門家です。ユーザーの質問を、知識ベース検索に適した具体的なクエリに展開してください。
ルール:
- 2〜4個のクエリを生成する
- 重複した意味のクエリは出力しない
- 必ずJSON配列のみを返す。説明文は一切不要。
例: ["定休日", "営業時間", "祝日営業", "年末年始休業"]`;

  try {
    const raw = await geminiComplete(system, query, 256);
    const cleaned = raw.trim().startsWith("```")
      ? raw.trim().split("```")[1].replace(/^json/, "").trim().split("```")[0].trim()
      : raw.trim();
    const queries = JSON.parse(cleaned) as string[];
    if (Array.isArray(queries) && queries.every((q) => typeof q === "string")) {
      if (!queries.includes(query)) queries.unshift(query);
      return queries.slice(0, 5);
    }
  } catch { /* fallthrough */ }
  return [query];
}

// ============================================================
// Context Compression（質問に必要な部分だけ抽出）
// ============================================================

async function compressContext(query: string, docs: Retrieved[]): Promise<string> {
  if (docs.length === 0) return "(資料なし)";

  const context = docs
    .map((d) => `source: ${d.source}\n${d.text}`)
    .join("\n\n---\n\n");

  const system = `あなたはテキスト圧縮の専門家です。与えられた資料から、ユーザーの質問に答えるために必要な情報だけを抽出してください。
ルール:
- 質問に直接関係する文章・数値・固有名詞のみ残す
- 不要な前置き・繰り返し・無関係な内容は削除する
- 資料に書かれていないことは絶対に追加しない
- source情報は保持する（"source: URL" の行はそのまま残す）`;

  try {
    return await geminiComplete(
      system,
      `# 質問\n${query}\n\n# 資料\n${context}\n\n# 指示\n質問に必要な情報だけを抽出してください。`,
      2048,
    );
  } catch {
    return context;
  }
}

// ============================================================
// Reflection（回答の自己評価・再検索判断）
// ============================================================

type ReflectionResult = {
  enough: boolean;
  reason: string;
  needMoreSearch: boolean;
  additionalQueries: string[];
};

async function reflectOnAnswer(
  query: string,
  answer: string,
  context: string
): Promise<ReflectionResult> {
  const system = `あなたは回答品質の評価専門家です。必ず以下のJSON形式のみで返してください。説明文は不要です。
{"enough": true, "reason": "評価理由", "need_more_search": false, "additional_queries": []}`;

  try {
    const res = await anthropic.messages.create({
      model: RERANKER_MODEL,
      max_tokens: 512,
      system,
      messages: [{
        role: "user",
        content: `# 質問\n${query}\n\n# 参照資料\n${context}\n\n# 生成された回答\n${answer}\n\n評価してください。`,
      }],
    });
    const raw = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
    const cleaned = raw.startsWith("```")
      ? raw.split("```")[1].replace(/^json/, "").trim().split("```")[0].trim()
      : raw;
    const data = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      enough: Boolean(data.enough ?? true),
      reason: String(data.reason ?? ""),
      needMoreSearch: Boolean(data.need_more_search ?? false),
      additionalQueries: Array.isArray(data.additional_queries)
        ? (data.additional_queries as string[])
        : [],
    };
  } catch {
    return { enough: true, reason: "評価スキップ", needMoreSearch: false, additionalQueries: [] };
  }
}

// ============================================================
// Agentic RAG（Claude tool_use による自律再検索）
// ============================================================

const AGENTIC_MAX_ITER = Number(env("AGENTIC_MAX_ITER") ?? "3");

type SearchEntry = {
  iteration: number;
  query: string;
  reason: string;
  hits: number;
};

async function agenticRAG(opts: {
  question: string;
  history: ClientMsg[];
  initialDocs: Retrieved[];
  mode: ConversationMode;
  tenantId: string | undefined;
  systemPrompt: string;
  compressedContext?: string;
}): Promise<{
  answer: string;
  usedDocs: Retrieved[];
  searchLog: SearchEntry[];
  iterations: number;
}> {
  const { question, history, initialDocs, mode, tenantId, systemPrompt } = opts;

  // source をキーに重複排除しながら全ドキュメント管理
  const docMap = new Map<string, Retrieved>();
  for (const d of initialDocs) docMap.set(d.source || d.id, d);

  const searchLog: SearchEntry[] = [
    { iteration: 0, query: question, reason: "初回検索", hits: initialDocs.length },
  ];

  const buildCtx = () =>
    [...docMap.values()]
      .map((d) => `source: ${d.source}\n${d.text}`.trim())
      .join("\n\n") || "(資料なし)";

  // ツール定義
  const tools: Anthropic.Tool[] = [
    {
      name: "search_knowledge_base",
      description:
        "社内知識ベースを検索して関連情報を取得します。" +
        "情報が不足している場合や、複数の異なるトピックを調べる必要がある場合に使ってください。",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string" as const, description: "検索クエリ（具体的なキーワードや質問文）" },
          reason: { type: "string" as const, description: "この検索を行う理由（例：「電話番号を調べるため」）" },
        },
        required: ["query", "reason"],
      },
    },
  ];

  // 会話履歴 + 最初のユーザーメッセージ
  // compressedContext が渡された場合はそれを初期資料として使う（Context Compression適用済み）
  const initialCtx = opts.compressedContext ?? buildCtx();
  type AMsg = Anthropic.MessageParam;
  const messages: AMsg[] = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    {
      role: "user" as const,
      content:
        `# 取得済み資料\n${initialCtx}\n\n` +
        `# 質問\n${question}\n\n` +
        "資料で回答できない情報がある場合は search_knowledge_base ツールを使ってください。" +
        "すべての情報があれば直接回答してください。",
    },
  ];

  let iterations = 0;
  let finalAnswer = "";

  while (true) {
    const response = await anthropic.messages.create({
      model: env("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6",
      max_tokens: 2048,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });

    // ツール呼び出しなし → 最終回答
    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      finalAnswer = textBlock?.type === "text" ? textBlock.text : "";
      break;
    }

    // ツール呼び出し処理
    messages.push({ role: "assistant" as const, content: response.content as AMsg["content"] });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      iterations++;
      const { query, reason } = block.input as { query: string; reason: string };

      // 追加検索（Hybrid Search + Reranker）
      const addRaw = await searchSupabase(query, 10, mode, tenantId);
      const { docs: addReranked } = addRaw.length > 0
        ? await rerankDocuments(query, addRaw, 3)
        : { docs: [] };

      for (const d of addReranked) docMap.set(d.source || d.id, d);

      searchLog.push({ iteration: iterations, query, reason, hits: addReranked.length });

      const resultCtx =
        addReranked.map((d) => `source: ${d.source}\n${d.text}`.trim()).join("\n\n") ||
        "(該当なし)";

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultCtx });
    }

    messages.push({ role: "user" as const, content: toolResults });

    // 上限到達 → ツールなしで強制最終回答
    if (iterations >= AGENTIC_MAX_ITER) {
      const finalResp = await anthropic.messages.create({
        model: env("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6",
        max_tokens: 2048,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages,
      });
      const textBlock = finalResp.content.find((b) => b.type === "text");
      finalAnswer = textBlock?.type === "text" ? textBlock.text : "";
      break;
    }
  }

  return {
    answer: finalAnswer,
    usedDocs: [...docMap.values()],
    searchLog,
    iterations,
  };
}

// ============================================================
// POST /api/chat
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatBody;

    const q = lastUserFromHistory(body);
    if (!q) {
      return NextResponse.json(
        { error: "message (or question) is required" },
        { status: 400 }
      );
    }

    const topK = Math.max(1, Math.min(Number(body.top_k ?? 20), 60));
    const clientId = body.client_id ?? env("NEXT_PUBLIC_CLIENT_ID") ?? "default";
    const mode: ConversationMode = body.mode ?? "normal";
    const sessionId = body.session_id ?? crypto.randomUUID();
    // tenant_id: リクエストボディ優先 → 環境変数 → clientId（フォールバック）
    const tenantId = body.tenant_id ?? env("NEXT_PUBLIC_TENANT_ID") ?? clientId;

    // ── クライアント設定取得 ──────────────────────────────────
    const config = await getClientConfig(clientId);

    // ── 1) Query Rewrite（クエリ展開）────────────────────────
    const rewrittenQueries = await queryRewrite(q);

    // ── 2) RAG検索（展開クエリ × Hybrid Search・重複排除）──
    const seenSources = new Set<string>();
    const allRetrieved: Retrieved[] = [];
    for (const rq of rewrittenQueries) {
      const results = await searchSupabase(rq, topK, mode, tenantId);
      for (const r of results) {
        const key = r.source || r.text.slice(0, 100);
        if (!seenSources.has(key)) {
          seenSources.add(key);
          allRetrieved.push(r);
        }
      }
    }
    const retrieved = allRetrieved;

    // ── 2.5) Reranker（Claudeによる関連度再評価）───────────
    const { docs: reranked, scores: rerankScores } =
      retrieved.length > 0
        ? await rerankDocuments(q, retrieved, RERANKER_TOP_N)
        : { docs: [], scores: [] };

    // ── 2.7) Context Compression（必要な部分だけ抽出）───────
    const compressed = await compressContext(q, reranked);

    // ── 2) 会話履歴 ──────────────────────────────────────────
    const history = normalizeHistory(body, 60);

    // ── 3) エスカレーション判定（クライアント設定のキーワード使用）──
    const matchedKeyword =
      config.emergencyKeywords.find((kw) => q.includes(kw)) ?? null;
    // Reranker後の1位ドキュメントのスコアを信頼度として使用
    const confidenceScore = reranked.length > 0 ? reranked[0].similarity : 0;
    const isLowConfidence = confidenceScore < 0.5 && retrieved.length > 0;
    const rerankedForLog = reranked; // ログ用に初回Reranker結果を保持

    // ── カテゴリ自動判定 ──────────────────────────────────────
    // 緊急キーワードにマッチ → キーワード名をそのままカテゴリに（例: "ガス漏れ"）
    // それ以外 → topicKeywords でトピック分類（例: "料金・請求"）
    // どれにも該当しない → "その他"
    let autoCategory: string;
    if (matchedKeyword) {
      autoCategory = matchedKeyword;
    } else {
      const matchedTopic = config.topicKeywords.find((t) =>
        t.keywords.some((kw) => q.includes(kw))
      );
      autoCategory = matchedTopic?.label ?? "その他";
    }
    const categoryId = body.category_id ?? autoCategory;

    // ── 4) システムプロンプト生成 ─────────────────────────────
    const tenantSystemPrompt = await fetchTenantSystemPrompt(tenantId);
    const systemPrompt = buildSystemPrompt(categoryId, mode, config, tenantSystemPrompt);

    // ── 5) Agentic RAG（自律再検索 + 回答生成）─────────────
    const startMs = Date.now();
    const {
      answer: rawAnswer,
      usedDocs,
      searchLog,
      iterations: agenticIterations,
    } = await agenticRAG({
      question: q,
      history,
      initialDocs: reranked,
      mode,
      tenantId,
      systemPrompt,
      compressedContext: compressed,
    });
    const responseMs = Date.now() - startMs;

    const answer = rawAnswer.replace(/\[#\d+\]/g, "").replace(/\s{2,}/g, " ").trim();

    // ── 5.5) Reflection（回答の自己評価・再検索判断）────────
    const reflection = await reflectOnAnswer(q, answer, compressed);

    // ── 6) ログ書き込み ───────────────────────────────────────
    let conversationId = body.conversation_id ?? null;
    let messageId = "";

    try {
      if (!conversationId) {
        conversationId = await startConversation({
          sessionId,
          clientId,
          categoryId,
          mode,
        });
      }

      await logUserMessage({ conversationId, content: q });

      if (matchedKeyword) {
        await escalateConversation({ conversationId, escalateType: "keyword" });
      } else if (isLowConfidence) {
        await escalateConversation({
          conversationId,
          escalateType: "low_confidence",
        });
      }

      messageId = await logAssistantMessage({
        conversationId,
        content: answer,
        confidenceScore,
        keywordMatched: matchedKeyword,
        retrievedDocIds: usedDocs.map((r) => r.id).filter(Boolean),
        retrievedDocTitles: usedDocs.map((r) => r.title),
        retrievedDocSources: usedDocs.map((r) => r.source),
        responseMs,
        unresolved: isLowConfidence && !matchedKeyword,
      });
    } catch (logErr) {
      console.error("[log] failed:", logErr);
    }

    // ── 7) レスポンス ─────────────────────────────────────────
    const response: ChatResponse = {
      message_id: messageId,
      conversation_id: conversationId ?? "",
      answer,
      confidence_score: confidenceScore,
      retrieved_docs: usedDocs.map((r) => ({
        id: r.id,
        title: r.title,
        source: r.source,
      })),
      escalated: !!(matchedKeyword || isLowConfidence),
      keyword_matched: matchedKeyword,
      response_ms: responseMs,
    };

    return NextResponse.json({
      ...response,
      // デバッグ用メタ情報
      meta: {
        top_k: topK,
        rpc: RPC_NAME,
        hits: retrieved.length,
        reranker_model: RERANKER_MODEL,
        reranker_top_n: RERANKER_TOP_N,
        reranked: rerankedForLog.length,
        rerank_scores: rerankScores,
        agentic_iterations: agenticIterations,
        agentic_search_log: searchLog,
        used_docs: usedDocs.length,
        mode,
        client_id: clientId,
        model: env("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6",
        query_rewrite_queries: rewrittenQueries,
        reflection: {
          enough: reflection.enough,
          reason: reflection.reason,
          need_more_search: reflection.needMoreSearch,
        },
      },
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    const msg = `${err?.name ?? "Error"}: ${err?.message ?? String(e)}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
