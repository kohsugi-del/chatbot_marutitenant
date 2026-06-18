// lib/getClientConfig.ts
// DBからクライアント設定を取得する。存在しない場合はファイルベースにフォールバック。

import type { ClientConfig } from "@/types/log";
import { clientConfig as defaultConfig } from "@/config/clients/default";

export async function getClientConfig(clientId: string): Promise<ClientConfig> {
  // 1. DBから取得を試みる（サーバーサイドのみ）
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
    const adminSecret = process.env.ADMIN_SECRET ?? "";

    if (adminSecret) {
      const res = await fetch(
        `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/client-config?client_id=${clientId}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const config = await res.json();
        if (config) return config as ClientConfig;
      }
    }
  } catch {
    // フォールバックへ
  }

  // 2. ファイルベース設定にフォールバック
  try {
    const mod = await import(`@/config/clients/${clientId}`);
    return mod.clientConfig as ClientConfig;
  } catch {
    return defaultConfig;
  }
}
