"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import BackButton from "@/components/BackButton";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

type SiteStatus = "pending" | "crawling" | "done" | "error";

type Site = {
  id: number;
  url: string;
  scope: string;
  type: string;
  status: SiteStatus | string;
  ingested_urls?: number | null;
  error_message?: string | null;
  created_at?: string;
};

type BulkResult = {
  total: number;
  ok: { url: string; id?: number | null }[];
  ng: { url: string; reason: string }[];
};

function normalizeUrl(u: string) {
  let x = u.trim().replace(/\s+/g, "");
  if (/^https?:\/\/[^/]+$/i.test(x)) x = x + "/";
  return x;
}

function parseUrls(text: string) {
  const tokens = text
    .split(/[\n\r\t ,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeUrl);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }
  return unique;
}

export default function WebSiteManagePage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<"single" | "all">("single");
  const FIXED_TYPE = "静的HTML";
  const [submitting, setSubmitting] = useState(false);
  const [autoIngest, setAutoIngest] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  /** 一覧取得（API） */
  const fetchSites = async () => {
    try {
      const res = await fetch(`${API_BASE}/sites`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Site[] = await res.json();
      setSites(data);
    } catch (e) {
      console.error("fetchSites:", e);
      setErrorMsg("バックエンドに接続できません。サーバーが起動しているか確認してください。");
    }
  };

  /** ingest実行（API） */
  const startIngest = async (id: number) => {
    setLoading(true);
    setErrorMsg("");
    try {
      // UIに即反映
      setSites((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "crawling", error_message: null } : s))
      );

      const res = await fetch(`${API_BASE}/sites/${id}/reingest_local`, { method: "POST" });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail ?? `HTTP ${res.status}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`取り込み開始に失敗しました: ${msg}`);
      setSites((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "error", error_message: msg } : s))
      );
    } finally {
      setLoading(false);
    }
  };

  /** サイト登録（API） */
  const addSite = async () => {
    const u = normalizeUrl(url);
    if (!u) return;
    setSubmitting(true);
    setErrorMsg("");
    setBulkResult(null);

    try {
      const res = await fetch(`${API_BASE}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u, scope, type: FIXED_TYPE }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const msg = Array.isArray(detail?.detail)
          ? detail.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join(", ")
          : (detail?.detail ?? `HTTP ${res.status}`);
        throw new Error(msg);
      }
      const created: Site = await res.json();
      setUrl("");
      await fetchSites();

      if (autoIngest) {
        await startIngest(created.id);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`追加に失敗しました: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  /** 一括追加（API） */
  const addSitesBulk = async () => {
    const urls = parseUrls(bulkText);
    if (urls.length === 0) return;
    setSubmitting(true);
    setErrorMsg("");
    setBulkResult(null);

    const ok: BulkResult["ok"] = [];
    const ng: BulkResult["ng"] = [];

    try {
      for (const u0 of urls) {
        const u = normalizeUrl(u0);
        if (!/^https?:\/\//i.test(u)) {
          ng.push({ url: u0, reason: "URLが http(s) ではありません" });
          continue;
        }
        try {
          const res = await fetch(`${API_BASE}/sites`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: u, scope, type: FIXED_TYPE }),
          });
          if (!res.ok) {
            const detail = await res.json().catch(() => ({}));
            const reason = Array.isArray(detail?.detail)
              ? detail.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join(", ")
              : (detail?.detail ?? `HTTP ${res.status}`);
            ng.push({ url: u, reason });
            continue;
          }
          const created: Site = await res.json();
          ok.push({ url: u, id: created.id });
        } catch (e: unknown) {
          ng.push({ url: u, reason: e instanceof Error ? e.message : String(e) });
        }
      }

      setBulkResult({ total: urls.length, ok, ng });
      setBulkText("");
      await fetchSites();

      if (autoIngest) {
        for (const item of ok) {
          if (typeof item.id === "number") await startIngest(item.id);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** 削除（API） */
  const deleteSite = async (id: number) => {
    if (!confirm("このWebサイトを削除しますか？")) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sites/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchSites();
    } catch (e: unknown) {
      setErrorMsg(`削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
    const timer = setInterval(fetchSites, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none fixed inset-0 opacity-45">
        <div className="absolute -top-40 left-10 h-96 w-96 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute top-40 right-10 h-96 w-96 rounded-full bg-cyan-500/25 blur-3xl" />
        <div className="absolute bottom-10 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-4xl px-4 py-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <div className="text-xs text-zinc-400">Sites</div>
              <h1 className="text-xl font-semibold tracking-tight">Webサイト管理</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
              sites: {sites.length}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-emerald-300">
              mode: API
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {errorMsg}
          </div>
        )}

        {/* Add site card */}
        <section className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">新しいWebサイトを追加</div>
            <button
              onClick={() => { setBulkMode((v) => !v); setBulkResult(null); }}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
            >
              {bulkMode ? "単一入力へ" : "一括入力へ"}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {!bulkMode ? (
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
              />
            ) : (
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`https://example.com/\nhttps://example.org/`}
                rows={6}
                className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-white/20"
              />
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "single" | "all")}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/20"
              >
                <option value="single">このURLのみ（基本）</option>
                <option value="all">配下すべて</option>
              </select>
              <div className="hidden sm:block" />
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={autoIngest}
                onChange={(e) => setAutoIngest(e.target.checked)}
                className="h-4 w-4"
              />
              追加後にすぐ取り込みを開始する
            </label>

            <button
              onClick={bulkMode ? addSitesBulk : addSite}
              disabled={submitting}
              className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:opacity-90 disabled:opacity-60"
            >
              {submitting
                ? bulkMode ? "一括追加中…" : "追加中…"
                : bulkMode ? "＋ Webサイトを一括追加" : "＋ Webサイトを追加"}
            </button>

            {bulkMode && (
              <div className="text-xs text-zinc-400">
                ※ 改行/スペース/カンマ区切りOK・重複URLは自動で除外します
              </div>
            )}

            {bulkResult && (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-zinc-300">
                <div className="font-semibold">
                  一括追加結果：{bulkResult.total}件中 {bulkResult.ok.length}件成功 /{" "}
                  {bulkResult.ng.length}件失敗
                </div>
                {bulkResult.ng.length > 0 && (
                  <div className="mt-2 space-y-1 text-red-200">
                    {bulkResult.ng.slice(0, 5).map((x) => (
                      <div key={x.url} className="truncate">
                        NG: {x.url}（{x.reason}）
                      </div>
                    ))}
                    {bulkResult.ng.length > 5 && (
                      <div className="text-zinc-400">…他 {bulkResult.ng.length - 5} 件</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* List card */}
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">登録済みWebサイト一覧</div>
            <button
              onClick={fetchSites}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
            >
              {loading ? "更新中…" : "更新"}
            </button>
          </div>

          {sites.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-sm text-zinc-400">
              まだWebサイトが登録されていません
            </div>
          ) : (
            <div className="space-y-3">
              {sites.map((site) => (
                <div
                  key={site.id}
                  className="rounded-2xl border border-white/10 bg-black/30 p-4 hover:bg-black/40"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold">{site.url}</div>
                        <span className="text-xs text-zinc-500">#{site.id}</span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-400">
                        {site.type} / {site.scope}
                        {site.ingested_urls != null && site.status === "done" && (
                          <span className="ml-2 text-emerald-300">
                            ・{site.ingested_urls}ページ取り込み済み
                          </span>
                        )}
                        {site.error_message && (
                          <span className="ml-2 text-red-200">・{site.error_message}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <StatusBadge status={site.status} />

                      <button
                        onClick={() => startIngest(site.id)}
                        disabled={loading || site.status === "crawling"}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                        title="取り込み開始"
                      >
                        ▶ 取込
                      </button>

                      {(site.status === "done" || site.status === "error") && (
                        <button
                          onClick={() => startIngest(site.id)}
                          disabled={loading}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                          title="再取り込み"
                        >
                          🔄 再取込
                        </button>
                      )}

                      <button
                        onClick={() => deleteSite(site.id)}
                        disabled={loading}
                        className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 hover:bg-red-500/15 disabled:opacity-60"
                        title="削除"
                      >
                        🗑 削除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-8 text-center text-xs text-zinc-500">Sites Dashboard</div>
      </div>
    </div>
  );
}
