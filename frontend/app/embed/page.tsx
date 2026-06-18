import { Suspense } from "react";
import { ReadonlyURLSearchParams } from "next/navigation";
import EmbedClient from "./EmbedClient";

export const dynamic = "force-dynamic";

// サーバーコンポーネントでURLパラメータを取得してクライアントに渡す
export default function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<ReadonlyURLSearchParams & Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense>
      <EmbedPageInner searchParams={searchParams} />
    </Suspense>
  );
}

async function EmbedPageInner({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tenantId = typeof params.tenant_id === "string" ? params.tenant_id : undefined;
  const title = typeof params.title === "string" ? params.title : undefined;

  return <EmbedClient tenantId={tenantId} title={title} />;
}
