"use client";

import ChatWidget from "@/components/ChatWidget";

type Props = {
  tenantId?: string;
  title?: string;
};

export default function EmbedClient({ tenantId, title }: Props) {
  return (
    <div>
      <ChatWidget defaultOpen tenantId={tenantId} title={title} />
    </div>
  );
}
