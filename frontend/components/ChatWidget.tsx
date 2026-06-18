"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ChatMascot from "@/components/ChatMascot";

// ボット回答を読みやすく整形する
function renderBotText(raw: string): React.ReactNode {
  // スペース直後の・（箇条書き）の前に改行を挿入
  // ※「農業・林業」のようにスペースなしの連結用・には影響しない
  const normalized = raw
    .replace(/[ 　]+・/g, "\n・")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = normalized.split("\n");
  const nodes: React.ReactNode[] = [];
  const pendingBullets: string[] = [];

  const flushBullets = (key: string) => {
    if (pendingBullets.length === 0) return;
    nodes.push(
      <div
        key={key}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginTop: 6,
          marginBottom: 4,
          paddingLeft: 10,
          borderLeft: "3px solid rgba(46,197,244,0.45)",
        }}
      >
        {pendingBullets.map((text, bi) => (
          <div key={bi} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <span style={{ color: "#2EC5F4", fontWeight: 700, lineHeight: "1.65", flexShrink: 0 }}>
              ・
            </span>
            <span style={{ flex: 1, lineHeight: "1.65" }}>{text}</span>
          </div>
        ))}
      </div>
    );
    pendingBullets.length = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flushBullets(`flush-${i}`);
      continue;
    }
    if (line.startsWith("・")) {
      pendingBullets.push(line.slice(1).trim());
    } else {
      flushBullets(`flush-before-${i}`);
      const nextNonEmpty = lines.slice(i + 1).find((l) => l.trim())?.trim() ?? "";
      const isHeader = nextNonEmpty.startsWith("・") && line.length <= 16;
      nodes.push(
        <p
          key={i}
          style={{
            margin: nodes.length > 0 ? "10px 0 2px" : "0 0 2px",
            fontWeight: isHeader ? 700 : 400,
            fontSize: isHeader ? 11 : "inherit",
            color: isHeader ? "#555" : "inherit",
            letterSpacing: isHeader ? "0.05em" : undefined,
            lineHeight: 1.7,
          }}
        >
          {line}
        </p>
      );
    }
  }
  flushBullets("final");

  return <>{nodes}</>;
}

type Msg = {
  role: "user" | "assistant";
  content: string;
  messageId?: string;
  conversationId?: string;
  feedback?: 1 | -1;
};

type ChatApiResponse = {
  answer?: string;
  message_id?: string;
  conversation_id?: string;
  error?: string;
};

type Props = {
  /** 最初から開いた状態にしたい場合 true（iframe内で常時表示など） */
  defaultOpen?: boolean;
  /** タイトル表示 */
  title?: string;
  /** テナントID（UUID）。未指定の場合は環境変数のデフォルトを使用 */
  tenantId?: string;
};

export default function ChatWidget({
  defaultOpen = false,
  title = "AIカスタマーサポート",
  tenantId,
}: Props) {
  // ===== Theme（ロボット色味に合わせた）=====
  const THEME = {
    // ロボット外枠系のシアン（少しだけ幅を持たせる）
    brand1: "#2EC5F4",
    brand2: "#38BDF8",
    // ロボットの顔面（濃いネイビー）
    ink: "#1F2933",
    // 背景
    bg: "#FFFFFF",
    // 罫線
    line: "rgba(0,0,0,0.10)",
    // 影
    shadow: "0 18px 40px rgba(0,0,0,0.22)",
    // ユーザー吹き出し背景（ブランド）
    userGrad: "linear-gradient(135deg, #2EC5F4, #38BDF8)",
    // Bot吹き出し背景（薄いブランド）
    botBg: "rgba(46,197,244,0.08)",
    // Bot吹き出し枠
    botBorder: "rgba(46,197,244,0.25)",
  } as const;

  const CATEGORIES = [
    { icon: "💬", label: "サービスについて", id: "サービス",   fullWidth: false },
    { icon: "📋", label: "手続き・契約",     id: "手続き・契約", fullWidth: false },
    { icon: "💡", label: "よくある質問",     id: "よくある質問", fullWidth: false },
    { icon: "📞", label: "お問い合わせ",     id: "お問い合わせ", fullWidth: false },
    { icon: "👥", label: "会社・採用",       id: "会社・採用", fullWidth: true  },
  ];

  const TERMS = [
    "本サービスは、生成AIを活用しており、登録された情報に基づき、生成AIが自動で質問にお答えするサービスです。サービス・手続き・料金などに関する情報の確認や調べ物のサポートとして、適切にご利用ください。",
    "質問によっては誤った回答が表示される場合がございます。回答の際に参考情報のリンク先が表示される場合は、あわせてご確認いただき、正確な情報かどうかをご判断ください。",
    "本サービスは生成AIを活用した機能のため、13歳未満のご利用はお控えください。また、18歳未満の方は保護者の許可を得てご利用ください。",
    "本サービスにおいて入力されたデータの内容は回答用の学習データとしては利用いたしません。入力した情報が他の利用者への回答に利用されることはありませんのでご安心ください。ただし、個人情報（氏名、住所、電話番号、お客様番号など）は入力しないでください。",
    "サービスの改善や回答精度の向上のため、Cookieを利用しています。お使いのブラウザの設定によっては、正常に表示・利用できない場合があります。",
    "入力された質問や回答に関するフィードバックは、適宜分析を行い、回答精度の向上を図っていきますので、ご理解とご協力をお願いします。",
  ];

  const [open, setOpen] = useState(defaultOpen);
  const [agreed, setAgreed] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // open時/更新時に最下部へ
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, messages, thinking]);

  const sendFeedback = async (index: number, value: 1 | -1) => {
    const msg = messages[index];
    if (!msg.messageId || !msg.conversationId) return;
    setMessages((m) => m.map((x, i) => i === index ? { ...x, feedback: value } : x));
    await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: msg.conversationId, message_id: msg.messageId, value }),
    }).catch(console.error);
  };

  const selectCategory = async (cat: typeof CATEGORIES[number]) => {
    setCategoryId(cat.id);
    const userMsg = `【${cat.label}】について質問します`;
    const nextMessages: Msg[] = [{ role: "user", content: userMsg }];
    setMessages(nextMessages);
    setThinking(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          top_k: 8,
          messages: nextMessages,
          session_id: sessionId,
          category_id: cat.id,
          ...(tenantId ? { tenant_id: tenantId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({})) as ChatApiResponse;
      const answer = data?.answer ?? "ご質問をどうぞ。";
      setMessages((m) => [...m, {
        role: "assistant", content: String(answer),
        messageId: data?.message_id, conversationId: data?.conversation_id,
      }]);
    } catch (e: unknown) {
      setMessages((m) => [...m, { role: "assistant", content: `エラー：${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setThinking(false);
    }
  };

  const send = async (overrideQ?: string) => {
    const q = (overrideQ ?? input).trim();
    if (!q || thinking) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setThinking(true);

    try {
      const nextMessages: Msg[] = [...messages, { role: "user", content: q }];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          top_k: 8,
          messages: nextMessages,
          session_id: sessionId,
          category_id: categoryId,
          ...(tenantId ? { tenant_id: tenantId } : {}),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API error: ${res.status}\n${text}`);
      }

      const data = await res.json().catch(() => ({})) as ChatApiResponse;
      const answer = data?.answer ?? "回答に失敗しました。";

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: String(answer),
          messageId: data?.message_id,
          conversationId: data?.conversation_id,
        },
      ]);
    } catch (e: unknown) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `エラー：${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setThinking(false);
    }
  };

  // ===== 共通スタイル（必要に応じて調整）=====
  const Z = 999999;

  const widgetBox: React.CSSProperties = {
    position: "fixed",
    right: 16,
    bottom: 16,
    width: 360,
    height: 520,
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "calc(100vh - 32px)",
    borderRadius: 18,
    border: `1px solid ${THEME.line}`,
    background: THEME.bg,
    boxShadow: THEME.shadow,
    overflow: "hidden",
    zIndex: Z,
    display: "flex",
    flexDirection: "column",
  };

  const header: React.CSSProperties = {
    height: 54,
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    color: "#fff",
    background: `linear-gradient(135deg, ${THEME.brand1}, ${THEME.brand2})`,
    borderBottom: `1px solid rgba(255,255,255,0.25)`,
  };

  const headerTitle: React.CSSProperties = {
    fontWeight: 800,
    fontSize: 14,
    letterSpacing: "0.02em",
    textShadow: "0 1px 0 rgba(0,0,0,0.10)",
  };

  const headerBtn: React.CSSProperties = {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.55)",
    background: "rgba(255,255,255,0.14)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  };

  const body: React.CSSProperties = {
    flex: 1,
    padding: 12,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    // うっすら背景
    background:
      "radial-gradient(1000px 400px at 100% 0%, rgba(46,197,244,0.12), transparent 60%), #fff",
  };

  const inputBar: React.CSSProperties = {
    padding: 10,
    borderTop: `1px solid ${THEME.line}`,
    display: "flex",
    gap: 8,
    flexShrink: 0,
    background: "#fff",
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    height: 40,
    padding: "0 12px",
    borderRadius: 14,
    border: `1px solid rgba(46,197,244,0.40)`,
    outline: "none",
    fontSize: 14,
    color: THEME.ink,
    boxShadow: "inset 0 1px 0 rgba(0,0,0,0.03)",
  };

  const sendBtn = (disabled: boolean): React.CSSProperties => ({
    height: 40,
    padding: "0 14px",
    borderRadius: 14,
    border: "0",
    background: disabled
      ? "rgba(46,197,244,0.45)"
      : `linear-gradient(135deg, ${THEME.brand1}, ${THEME.brand2})`,
    color: "#fff",
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : "0 10px 22px rgba(46,197,244,0.35)",
  });

  const bubbleBase: React.CSSProperties = {
    maxWidth: "90%",
    padding: "12px 14px",
    borderRadius: 16,
    fontSize: 14,
    lineHeight: 1.7,
    wordBreak: "break-word",
  };

  const userBubble: React.CSSProperties = {
    ...bubbleBase,
    alignSelf: "flex-end",
    color: "#fff",
    background: THEME.userGrad,
    boxShadow: "0 10px 22px rgba(46,197,244,0.25)",
    whiteSpace: "pre-wrap",
  };

  const botBubble: React.CSSProperties = {
    ...bubbleBase,
    alignSelf: "flex-start",
    color: THEME.ink,
    background: THEME.botBg,
    border: `1px solid ${THEME.botBorder}`,
  };

  return (
    <>
      {/* 右下のマスコットボタン */}
      {!open && <ChatMascot onClick={() => setOpen(true)} />}

      {/* チャットパネル */}
      {open && (
        <div style={widgetBox}>
          {/* ヘッダー */}
          <div style={header}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.18)",
                border: "1px solid rgba(255,255,255,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <Image
                src="/chatbot_icon2.jpg"
                alt="robot"
                width={26}
                height={26}
                priority
                style={{ objectFit: "cover" }}
              />
            </span>

            <div style={headerTitle}>{title}</div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => { setMessages([]); setCategoryId(null); }}
                style={headerBtn}
                title="会話をリセット"
              >
                リセット
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={headerBtn}
                title="閉じる"
              >
                閉じる
              </button>
            </div>
          </div>

          {/* メッセージ */}
          {/* 同意画面 */}
          {!agreed && (
            <div style={{
              flex: 1,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              padding: "16px 14px 12px",
              gap: 12,
              background: "#fff",
            }}>
              <div style={{
                fontSize: 13,
                fontWeight: 700,
                color: THEME.ink,
                borderBottom: `2px solid ${THEME.brand1}`,
                paddingBottom: 8,
              }}>
                【ご利用上の注意事項】
              </div>
              <p style={{ fontSize: 12, color: THEME.ink, margin: 0, lineHeight: 1.6 }}>
                ご利用の前に、以下の注意事項を必ずお読みください。
              </p>
              <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                {TERMS.map((t, i) => (
                  <li key={i} style={{ fontSize: 12, color: THEME.ink, lineHeight: 1.7 }}>
                    {t}
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={() => setAgreed(true)}
                style={{
                  marginTop: 4,
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "none",
                  background: `linear-gradient(135deg, ${THEME.brand1}, ${THEME.brand2})`,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  boxShadow: "0 8px 20px rgba(46,197,244,0.35)",
                  letterSpacing: "0.02em",
                }}
              >
                上記に同意して質問する
              </button>
            </div>
          )}

          {/* チャット本体（同意後のみ表示） */}
          <div ref={listRef} style={{ ...body, display: agreed ? "flex" : "none" }}>
            {messages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* ウェルカムメッセージ */}
                <div style={{ ...botBubble, alignSelf: "flex-start" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                    ● 応答中
                  </div>
                  <div style={{ fontSize: 13 }}>
                    ご用件のカテゴリをお選びください。<br />
                    そのままご質問いただくこともできます。
                  </div>
                </div>

                {/* カテゴリボタン */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => selectCategory(cat)}
                      style={{
                        gridColumn: cat.fullWidth ? "1 / -1" : undefined,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: `1px solid ${THEME.botBorder}`,
                        background: THEME.botBg,
                        color: THEME.ink,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "background 120ms",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = `rgba(46,197,244,0.18)`;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = THEME.botBg;
                      }}
                    >
                      <span style={{ fontSize: 18 }}>{cat.icon}</span>
                      <span>{cat.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div key={i}>
                  <div style={isUser ? userBubble : botBubble}>
                    {isUser ? m.content : renderBotText(m.content)}
                  </div>
                  {!isUser && m.messageId && (
                    <div style={{ display: "flex", gap: 6, marginTop: 4, marginLeft: 2 }}>
                      <button
                        onClick={() => sendFeedback(i, 1)}
                        disabled={!!m.feedback}
                        style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 8, border: "1px solid",
                          borderColor: m.feedback === 1 ? "rgba(16,185,129,0.5)" : "rgba(0,0,0,0.15)",
                          background: m.feedback === 1 ? "rgba(16,185,129,0.15)" : "rgba(0,0,0,0.04)",
                          color: m.feedback === 1 ? "#059669" : "#6b7280",
                          cursor: m.feedback ? "default" : "pointer",
                        }}
                      >
                        👍 解決した
                      </button>
                      <button
                        onClick={() => sendFeedback(i, -1)}
                        disabled={!!m.feedback}
                        style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 8, border: "1px solid",
                          borderColor: m.feedback === -1 ? "rgba(59,130,246,0.5)" : "rgba(0,0,0,0.15)",
                          background: m.feedback === -1 ? "rgba(59,130,246,0.15)" : "rgba(0,0,0,0.04)",
                          color: m.feedback === -1 ? "#2563eb" : "#6b7280",
                          cursor: m.feedback ? "default" : "pointer",
                        }}
                      >
                        👎 解決しなかった
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {thinking && (
              <div
                style={{
                  ...botBubble,
                  opacity: 0.75,
                }}
              >
                返信中…
              </div>
            )}
          </div>

          {/* 入力（同意後のみ） */}
          <div style={{ ...inputBar, display: agreed ? "flex" : "none" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              placeholder="ご質問をどうぞ"
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={thinking || !input.trim()}
              style={sendBtn(thinking || !input.trim())}
            >
              送信
            </button>
          </div>
        </div>
      )}
    </>
  );
}
