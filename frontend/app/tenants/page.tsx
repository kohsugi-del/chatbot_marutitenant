"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BackButton from "@/components/BackButton";

type Tenant = {
  id: string;
  name: string;
  client_id?: string;
  system_prompt: string;
  api_key: string;
  phone_normal?: string;
  phone_emergency?: string;
  business_hours?: string;
  emergency_keywords?: string;
  topic_keywords?: string;
};

type NewTenantResult = Tenant & { _justCreated?: boolean };

const DEFAULT_PROMPT =
  "あなたは{会社名}専用の案内チャットボットです。\n以下の資料だけを根拠に回答してください。\n推測や一般論は書かないでください。";

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // フォーム
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [phoneNormal, setPhoneNormal] = useState("");
  const [phoneEmergency, setPhoneEmergency] = useState("");
  const [businessHours, setBusinessHours] = useState("平日 9:00〜17:00");
  const [emergencyKeywords, setEmergencyKeywords] = useState("火災, 避難, 緊急");
  const [submitting, setSubmitting] = useState(false);

  // 作成直後の結果表示
  const [created, setCreated] = useState<NewTenantResult | null>(null);
  const [copied, setCopied] = useState<"id" | "key" | null>(null);

  // 編集
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTenants = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/tenants");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      setTenants(await res.json());
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const createTenant = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setErrorMsg("");
    setCreated(null);
    try {
      const keywords = emergencyKeywords
        .split(/[,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          client_id: clientId.trim() || undefined,
          system_prompt: systemPrompt.trim(),
          phone_normal: phoneNormal.trim() || undefined,
          phone_emergency: phoneEmergency.trim() || undefined,
          business_hours: businessHours.trim() || undefined,
          emergency_keywords: keywords.length ? JSON.stringify(keywords) : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail ?? d?.error ?? `HTTP ${res.status}`);
      }
      const tenant: NewTenantResult = await res.json();
      tenant._justCreated = true;
      setCreated(tenant);
      setName("");
      setClientId("");
      setSystemPrompt(DEFAULT_PROMPT);
      setPhoneNormal("");
      setPhoneEmergency("");
      setBusinessHours("平日 9:00〜17:00");
      setEmergencyKeywords("火災, 避難, 緊急");
      await fetchTenants();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteTenant = async (id: string, tenantName: string) => {
    if (!confirm(`「${tenantName}」を削除しますか？`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (created?.id === id) setCreated(null);
      await fetchTenants();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const [editClientId, setEditClientId] = useState("");
  const [editPhoneNormal, setEditPhoneNormal] = useState("");
  const [editPhoneEmergency, setEditPhoneEmergency] = useState("");
  const [editBusinessHours, setEditBusinessHours] = useState("");
  const [editEmergencyKeywords, setEditEmergencyKeywords] = useState("");

  const startEdit = (t: Tenant) => {
    setEditingId(t.id);
    setEditName(t.name);
    setEditClientId(t.client_id ?? "");
    setEditPrompt(t.system_prompt);
    setEditPhoneNormal(t.phone_normal ?? "");
    setEditPhoneEmergency(t.phone_emergency ?? "");
    setEditBusinessHours(t.business_hours ?? "");
    const kw = t.emergency_keywords
      ? (JSON.parse(t.emergency_keywords) as string[]).join(", ")
      : "";
    setEditEmergencyKeywords(kw);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditPrompt("");
  };

  const saveTenant = async (id: string) => {
    setSaving(true);
    setErrorMsg("");
    try {
      const keywords = editEmergencyKeywords
        .split(/[,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch(`/api/tenants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          client_id: editClientId.trim() || undefined,
          system_prompt: editPrompt.trim(),
          phone_normal: editPhoneNormal.trim() || undefined,
          phone_emergency: editPhoneEmergency.trim() || undefined,
          business_hours: editBusinessHours.trim() || undefined,
          emergency_keywords: keywords.length ? JSON.stringify(keywords) : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail ?? d?.error ?? `HTTP ${res.status}`);
      }
      setEditingId(null);
      await fetchTenants();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (text: string, type: "id" | "key") => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  useEffect(() => { fetchTenants(); }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 opacity-45">
        <div className="absolute -top-40 left-10 h-96 w-96 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute top-40 right-10 h-96 w-96 rounded-full bg-cyan-500/25 blur-3xl" />
        <div className="absolute bottom-10 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-4xl px-4 py-8">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <BackButton />
          <div>
            <div className="text-xs text-zinc-400">Admin</div>
            <h1 className="text-xl font-semibold tracking-tight">テナント管理</h1>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {errorMsg}
          </div>
        )}

        {/* 作成直後の結果 */}
        {created?._justCreated && (
          <section className="mb-6 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 backdrop-blur">
            <div className="mb-3 text-sm font-semibold text-emerald-300">
              テナントを作成しました — APIキーを控えてください
            </div>

            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs text-zinc-400">テナント ID（NEXT_PUBLIC_TENANT_ID に設定）</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-xl bg-black/40 px-3 py-2 text-sm font-mono text-emerald-200 break-all">
                    {created.id}
                  </code>
                  <button
                    onClick={() => copyToClipboard(created.id, "id")}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 whitespace-nowrap"
                  >
                    {copied === "id" ? "コピー済み ✓" : "コピー"}
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs text-zinc-400">API キー（X-API-Key ヘッダーに使用）</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-xl bg-black/40 px-3 py-2 text-sm font-mono text-emerald-200 break-all">
                    {created.api_key}
                  </code>
                  <button
                    onClick={() => copyToClipboard(created.api_key, "key")}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 whitespace-nowrap"
                  >
                    {copied === "key" ? "コピー済み ✓" : "コピー"}
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-black/30 p-3 text-xs text-zinc-400 space-y-1">
                <div className="font-semibold text-zinc-300">次のステップ</div>
                <div>1. <code className="text-zinc-200">frontend/.env.local</code> の <code className="text-zinc-200">NEXT_PUBLIC_TENANT_ID</code> を上の ID に設定</div>
                <div>2. Webサイト管理ページでサイトを登録・取り込み</div>
                <div>3. チャットで動作確認</div>
              </div>
            </div>
          </section>
        )}

        {/* 新規作成フォーム */}
        <section className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-4 text-sm font-semibold">新しいテナントを追加</div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">テナント名 <span className="text-red-400">*</span></label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例: クウェスト合同会社"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">
                  クライアントID
                  <span className="ml-1 text-zinc-500">（NEXT_PUBLIC_CLIENT_ID に設定する値）</span>
                </label>
                <input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="例: qwest"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-zinc-400">システムプロンプト <span className="text-red-400">*</span></label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20 font-mono"
              />
            </div>

            <div className="rounded-xl border border-white/5 bg-white/3 p-3 space-y-3">
              <div className="text-xs font-semibold text-zinc-400">チャット設定</div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">通常窓口 電話番号</label>
                  <input
                    value={phoneNormal}
                    onChange={(e) => setPhoneNormal(e.target.value)}
                    placeholder="例: 0166-XX-XXXX"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">緊急窓口 電話番号</label>
                  <input
                    value={phoneEmergency}
                    onChange={(e) => setPhoneEmergency(e.target.value)}
                    placeholder="例: 0166-XX-XXXX（24時間）"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">営業時間</label>
                  <input
                    value={businessHours}
                    onChange={(e) => setBusinessHours(e.target.value)}
                    placeholder="例: 平日 9:00〜17:00"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">緊急キーワード（カンマ区切り）</label>
                  <input
                    value={emergencyKeywords}
                    onChange={(e) => setEmergencyKeywords(e.target.value)}
                    placeholder="例: 火災, 避難, 緊急"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={createTenant}
              disabled={submitting || !name.trim()}
              className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "作成中…" : "＋ テナントを作成"}
            </button>
          </div>
        </section>

        {/* テナント一覧 */}
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">テナント一覧</div>
            <button
              onClick={fetchTenants}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
            >
              {loading ? "取得中…" : "更新"}
            </button>
          </div>

          {tenants.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-sm text-zinc-400">
              テナントがまだありません
            </div>
          ) : (
            <div className="space-y-3">
              {tenants.map((t) => (
                <div key={t.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  {editingId === t.id ? (
                    // 編集モード
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-zinc-400">テナント名</label>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/20"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-zinc-400">クライアントID</label>
                          <input
                            value={editClientId}
                            onChange={(e) => setEditClientId(e.target.value)}
                            placeholder="例: qwest"
                            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/20"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-zinc-400">システムプロンプト</label>
                        <textarea
                          value={editPrompt}
                          onChange={(e) => setEditPrompt(e.target.value)}
                          rows={4}
                          className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm font-mono outline-none focus:border-white/20"
                        />
                      </div>
                      <div className="rounded-xl border border-white/5 bg-white/3 p-3 space-y-3">
                        <div className="text-xs font-semibold text-zinc-400">チャット設定</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-zinc-400">通常窓口 電話番号</label>
                            <input value={editPhoneNormal} onChange={(e) => setEditPhoneNormal(e.target.value)} placeholder="0166-XX-XXXX" className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/20" />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-zinc-400">緊急窓口 電話番号</label>
                            <input value={editPhoneEmergency} onChange={(e) => setEditPhoneEmergency(e.target.value)} placeholder="0166-XX-XXXX" className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/20" />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs text-zinc-400">営業時間</label>
                            <input value={editBusinessHours} onChange={(e) => setEditBusinessHours(e.target.value)} placeholder="平日 9:00〜17:00" className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/20" />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-zinc-400">緊急キーワード（カンマ区切り）</label>
                            <input value={editEmergencyKeywords} onChange={(e) => setEditEmergencyKeywords(e.target.value)} placeholder="火災, 避難, 緊急" className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/20" />
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveTenant(t.id)}
                          disabled={saving}
                          className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-zinc-900 hover:opacity-90 disabled:opacity-60"
                        >
                          {saving ? "保存中…" : "保存"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs hover:bg-white/10"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    // 表示モード
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm">{t.name}</div>
                          <div className="mt-1 font-mono text-xs text-zinc-400 truncate">{t.id}</div>
                          <div className="mt-1 font-mono text-xs text-zinc-500 truncate">
                            key: {t.api_key.slice(0, 12)}…
                          </div>
                          <div className="mt-2 text-xs text-zinc-500 line-clamp-2">{t.system_prompt}</div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Link
                            href={`/embed?tenant_id=${t.id}&title=${encodeURIComponent(t.name)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300 hover:bg-sky-500/15 whitespace-nowrap"
                          >
                            チャットをテスト ↗
                          </Link>
                          <button
                            onClick={() => startEdit(t)}
                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 whitespace-nowrap"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => deleteTenant(t.id, t.name)}
                            disabled={loading}
                            className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 hover:bg-red-500/15 disabled:opacity-60 whitespace-nowrap"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                      {/* 埋め込みコード */}
                      <details className="text-xs text-zinc-500">
                        <summary className="cursor-pointer hover:text-zinc-300 select-none">埋め込みコードを表示</summary>
                        <div className="mt-2 rounded-xl bg-black/40 p-3 font-mono text-zinc-400 break-all">
                          {`<iframe src="http://localhost:3000/embed?tenant_id=${t.id}" width="400" height="600" frameborder="0" />`}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-8 text-center text-xs text-zinc-500">Tenant Admin</div>
      </div>
    </div>
  );
}
