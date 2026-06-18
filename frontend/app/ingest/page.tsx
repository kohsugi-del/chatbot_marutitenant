"use client";

import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import StatusBadge from "@/components/StatusBadge";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
const API_KEY = process.env.NEXT_PUBLIC_BACKEND_API_KEY ?? "";

function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return API_KEY ? { "X-API-Key": API_KEY, ...extra } : extra;
}

type UiStatus = "pending" | "processing" | "done" | "error";

type FileItem = {
  id: number;
  filename: string;
  status: UiStatus;
  ingested_chunks?: number | null;
  error_message?: string | null;
  created_at?: string;
};

export default function IngestPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  /** 一覧取得（API） */
  const fetchFiles = async () => {
    try {
      const res = await fetch(`${API_BASE}/files`, { headers: apiHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FileItem[] = await res.json();
      setFiles(data);
      setErrorMsg("");
    } catch (e) {
      console.error("fetchFiles:", e);
      setErrorMsg("バックエンドに接続できません。サーバーが起動しているか確認してください。");
    }
  };

  /** PDFアップロード → ingest実行（API） */
  const uploadOne = async (file: File): Promise<void> => {
    // 1. アップロード
    const formData = new FormData();
    formData.append("file", file);

    const uploadRes = await fetch(`${API_BASE}/files`, {
      method: "POST",
      headers: apiHeaders(),
      body: formData,
    });
    if (!uploadRes.ok) {
      const detail = await uploadRes.json().catch(() => ({}));
      throw new Error(detail?.detail ?? `アップロード失敗 HTTP ${uploadRes.status}`);
    }
    const uploaded: FileItem = await uploadRes.json();

    // UIに即反映（processing状態）
    setFiles((prev) => [{ ...uploaded, status: "processing" }, ...prev]);

    // 2. ingest実行
    const ingestRes = await fetch(`${API_BASE}/files/${uploaded.id}/ingest_local`, {
      method: "POST",
      headers: apiHeaders(),
    });
    if (!ingestRes.ok) {
      const detail = await ingestRes.json().catch(() => ({}));
      throw new Error(detail?.detail ?? `Ingest失敗 HTTP ${ingestRes.status}`);
    }
    const result = await ingestRes.json();

    // 完了状態に更新
    setFiles((prev) =>
      prev.map((f) =>
        f.id === uploaded.id
          ? { ...f, status: "done", ingested_chunks: result.ingested_chunks ?? null }
          : f
      )
    );
  };

  /** 複数ファイルアップロード */
  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;

    const pdfs = selected.filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );

    if (pdfs.length === 0) {
      setStatus("PDFファイルが選択されていません。");
      e.target.value = "";
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      let ok = 0;
      let ng = 0;

      for (let i = 0; i < pdfs.length; i++) {
        const file = pdfs[i];
        setStatus(`(${i + 1}/${pdfs.length}) 処理中：${file.name}`);

        try {
          await uploadOne(file);
          ok++;
        } catch (err: unknown) {
          console.error("[UPLOAD NG]", file.name, err);
          const msg = err instanceof Error ? err.message : String(err);
          setErrorMsg(`${file.name}: ${msg}`);
          ng++;
        }
      }

      setStatus(`完了：成功 ${ok}件 / 失敗 ${ng}件`);
      await fetchFiles();
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  /** 再取り込み（API） */
  const reingestFile = async (id: number) => {
    setLoading(true);
    setStatus("再取り込み中…");
    setErrorMsg("");

    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing" } : f)));

    try {
      const res = await fetch(`${API_BASE}/files/${id}/ingest_local`, { method: "POST", headers: apiHeaders() });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail ?? `HTTP ${res.status}`);
      }
      const result = await res.json();

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, status: "done", ingested_chunks: result.ingested_chunks ?? null }
            : f
        )
      );
      setStatus(`再取り込み完了（${result.ingested_chunks ?? "?"} チャンク）`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: "error", error_message: msg } : f))
      );
      setErrorMsg(`再取り込みに失敗しました: ${msg}`);
      setStatus("");
    } finally {
      setLoading(false);
    }
  };

  /** 削除（API） */
  const deleteFile = async (id: number) => {
    if (!confirm("このファイルを削除しますか？")) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/files/${id}`, { method: "DELETE", headers: apiHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchFiles();
      setStatus("削除しました。");
    } catch (e: unknown) {
      setErrorMsg(`削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    const timer = setInterval(fetchFiles, 5000);
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
              <div className="text-xs text-zinc-400">Ingest</div>
              <h1 className="text-xl font-semibold tracking-tight">ファイル管理</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-zinc-300">
              files: {files.length}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-emerald-300">
              mode: API
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-200">
            {errorMsg}
          </div>
        )}

        <section className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-2 text-sm font-semibold">アップロード</div>
          <p className="text-sm text-zinc-400">
            PDFをアップロードすると自動でチャンク化・ベクトル化してSupabaseに保存されます。
          </p>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex w-fit cursor-pointer items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:opacity-90 disabled:opacity-60">
              <input
                type="file"
                accept=".pdf"
                multiple
                onChange={uploadFile}
                disabled={loading}
                className="hidden"
              />
              ＋ ファイルを選択（複数可）
            </label>

            <div className="text-xs text-zinc-400">
              {loading ? "処理中…" : "PDFのみ対応"}
            </div>
          </div>

          {status && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-zinc-200">
              {status}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">ファイル一覧</div>
            <button
              onClick={fetchFiles}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
            >
              {loading ? "更新中…" : "更新"}
            </button>
          </div>

          {files.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-sm text-zinc-400">
              まだファイルがありません
            </div>
          ) : (
            <div className="space-y-3">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="rounded-2xl border border-white/10 bg-black/30 p-4 hover:bg-black/40"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold">{file.filename}</div>
                        <span className="text-xs text-zinc-500">#{file.id}</span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-400">
                        {file.ingested_chunks != null && file.status === "done" && (
                          <>・{file.ingested_chunks} チャンク保存済み</>
                        )}
                        {file.error_message && <>・エラー: {file.error_message}</>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <StatusBadge status={file.status} />

                      {(file.status === "done" || file.status === "error") && (
                        <button
                          onClick={() => reingestFile(file.id)}
                          disabled={loading}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                          title="再取り込み"
                        >
                          🔄 再取込
                        </button>
                      )}

                      <button
                        onClick={() => deleteFile(file.id)}
                        disabled={loading}
                        className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-200 hover:bg-blue-500/15 disabled:opacity-60"
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

        <div className="mt-8 text-center text-xs text-zinc-500">Ingest Dashboard</div>
      </div>
    </div>
  );
}
