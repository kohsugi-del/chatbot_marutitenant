// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs"; // Edgeにしない（OpenAI/Supabaseで安定）
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

type ChatBody = {
  question?: string;
  message?: string;
  top_k?: number;
  messages?: ClientMsg[];
  session_id?: string; // フロントから渡すセッションID
};

// ---- OpenAI ----
const openai = new OpenAI({ apiKey: mustEnv("OPENAI_API_KEY") });

// ---- Supabase ----
const SUPABASE_URL =
  env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL") ?? "";

if (!SUPABASE_URL) {
  throw new Error(
    "SUPABASE_URL is missing (set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL)"
  );
}

// 優先：SERVICE_ROLE（サーバー専用） → 無ければ ANON（機能制限あり）
const SUPABASE_KEY =
  env("SUPABASE_SERVICE_ROLE_KEY") ??
  env("SUPABASE_ANON_KEY") ??
  env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
  "";

if (!SUPABASE_KEY) {
  throw new Error(
    "SUPABASE key is missing (set SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)"
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// RPC名は環境変数で切替可能（match_documents / match_chunks どちらでも）
const RPC_NAME = env("SUPABASE_MATCH_RPC") ?? "match_documents";

// 任意：閾値（RPCが対応している場合のみ。未対応なら env を設定しない）
const MATCH_THRESHOLD = Number(env("SUPABASE_MATCH_THRESHOLD") ?? "0");

async function embedQuery(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding as unknown as number[];
}

type Retrieved = {
  text: string;
  source: string;
  similarity: number;
};

async function searchSupabase(query: string, topK: number): Promise<Retrieved[]> {
  const qEmb = await embedQuery(query);

  const args: Record<string, any> = {
    query_embedding: qEmb,
    match_count: topK,
  };
  if (MATCH_THRESHOLD > 0) args.match_threshold = MATCH_THRESHOLD;

  const { data, error } = await supabase.rpc(RPC_NAME, args);

  if (error) {
    // RLSや権限不足、RPC名の間違いもここに出る
    throw new Error(`supabase.rpc(${RPC_NAME}) failed: ${error.message}`);
  }

  const rows = (data ?? []) as any[];

  return rows
    .map((row) => {
      const text = String(
        row.content ??
          row.text ??
          row.chunk ??
          row.body ??
          row.page_text ??
          row.document ??
          ""
      ).trim();

      const source = String(
        row.source ??
          row.url ??
          row.source_url ??
          row.page_url ??
          row.doc_url ??
          row.path ??
          ""
      ).trim();

      const similarity = Number(row.similarity ?? row.score ?? 0);

      return { text, source, similarity };
    })
    .filter((r) => r.text.length > 0);
}

function lastUserFromHistory(body: ChatBody): string {
  // messages があれば最後の user を優先
  if (Array.isArray(body.messages) && body.messages.length) {
    const lastUser = [...body.messages].reverse().find((m) => m?.role === "user");
    const q = String(lastUser?.content ?? "").trim();
    if (q) return q;
  }
  // 無ければ従来通り
  return String(body.question ?? body.message ?? "").trim();
}

function normalizeHistory(body: ChatBody, maxTurns = 60): ClientMsg[] {
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const cleaned = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? "").slice(0, 4000),
    }))
    .filter((m) => m.content.trim().length > 0);

  // 直近だけ
  return cleaned.slice(-maxTurns);
}

/**
 * 会話履歴 + コンテキスト をまとめてOpenAIへ渡す
 * - 「この中で〜」のような照応は履歴で解決する
 * - ただし根拠は必ずコンテキスト（RAG）
 */
function buildMessagesWithHistory(opts: {
  question: string;
  history: ClientMsg[];
  contexts: { text: string; source: string }[];
}) {
  const { question, history, contexts } = opts;

  const ctx = contexts
    .map((c, i) => `[#${i + 1}] source: ${c.source}\n${c.text}`.trim())
    .join("\n\n");

  const system = `あなたは与えられたコンテキストに基づいて回答するアシスタントです。
- 根拠がコンテキストに無い内容は推測しないで「不明」「資料内では特定できません」と答えてください。
- ユーザーの「この中で」「それ」「さっきの」などは会話履歴を参照して解釈してください。
- ただし“事実の根拠”は必ずコンテキストに置いてください（履歴は意図解釈用）。
- 回答は日本語で、できるだけ具体的に。会社名がコンテキスト内に明記されていれば列挙してください。`;

  // 最後に context と 今回の質問をまとめて投げる
  const finalUser = `# コンテキスト
${ctx || "(コンテキストなし)"}

# 今回の質問
${question}

# 回答（日本語）
`;

  // 履歴は system の次に並べる
  return [
    { role: "system" as const, content: system },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: finalUser },
  ];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatBody;

    // ★検索クエリは「最後の user」を使う（ここが会話継続のキモ）
    const q = lastUserFromHistory(body);
    if (!q) {
      return NextResponse.json(
        { error: "question (or message) is required" },
        { status: 400 }
      );
    }

    // top_k（必要なら上限を上げてOK）
    const topK = Math.max(1, Math.min(Number(body.top_k ?? 20), 60));

    // 1) 検索（RAG）
    const retrieved = await searchSupabase(q, topK);

    // 2) 履歴（意図解釈用）
    const history = normalizeHistory(body, 60);

    // 3) 回答生成（履歴 + context）
    const messages = buildMessagesWithHistory({
      question: q,
      history,
      contexts: retrieved.map((r) => ({ text: r.text, source: r.source })),
    });

    const chat = await openai.chat.completions.create({
      model: env("OPENAI_CHAT_MODEL") ?? "gpt-4.1-mini",
      messages,
      temperature: 0.2,
    });

    const answer = chat.choices[0]?.message?.content ?? "";

    // references 形式（フロントが使いやすい）
    const references = retrieved.map((r) => ({
      source: r.source,
      score: Number(r.similarity),
    }));

    // ── 会話ログを Supabase に保存 ────────────────────────────────
    if (body.session_id) {
      try {
        // セッションを upsert（既存なら無視）
        await supabase
          .from("sessions")
          .upsert(
            { id: body.session_id, municipality_id: "htrk-asahikawa" },
            { onConflict: "id" }
          );

        // turn_order は body.messages の長さで決まる
        // （フロントは常に「今回のuser発話」を末尾に含めて送る）
        const userTurnOrder = body.messages?.length ?? 1;
        const assistantTurnOrder = userTurnOrder + 1;

        await supabase.from("turns").insert([
          {
            session_id: body.session_id,
            turn_order: userTurnOrder,
            role: "user",
            content: q,
          },
          {
            session_id: body.session_id,
            turn_order: assistantTurnOrder,
            role: "assistant",
            content: answer,
          },
        ]);
      } catch (logErr) {
        // ログ失敗でも回答は返す
        console.error("[log] failed to save turn:", logErr);
      }
    }
    // ─────────────────────────────────────────────────────────────

    return NextResponse.json({
      answer,
      references,
      meta: {
        top_k: topK,
        rpc: RPC_NAME,
        hits: retrieved.length,
        threshold: MATCH_THRESHOLD,
        used_history: history.length,
      },
    });
  } catch (e: any) {
    const msg = `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
