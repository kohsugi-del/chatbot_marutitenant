"use client";

import { useEffect, useState } from "react";
import ChatMascot from "@/components/ChatMascot";

type Props = {
  embedPath?: string;
};

export default function FloatingChatLauncher({
  embedPath = "/embed",
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {/* パネル（/embed をそのまま表示） */}
      <div
        className={[
          "fixed z-[999999] right-4 bottom-[88px]",
          "w-[380px] h-[560px]",
          "max-w-[calc(100vw-32px)] max-h-[calc(100vh-140px)]",
          "rounded-[24px] overflow-hidden shadow-2xl",
          "bg-white",
          open ? "block" : "hidden",
        ].join(" ")}
      >
        {/* close だけ上に重ねる */}
        <button
          onClick={() => setOpen(false)}
          className="absolute right-2 top-2 z-[2] w-9 h-9 rounded-full bg-black/10 hover:bg-black/20 transition flex items-center justify-center text-black"
          aria-label="close"
          type="button"
        >
          ✕
        </button>

        <iframe
          src={embedPath}
          title="Chat"
          className="w-full h-full border-0"
        />
      </div>

      {/* 右下のマスコットボタン（常時表示・クリックでパネル開閉） */}
      <ChatMascot onClick={() => setOpen((v) => !v)} />
    </>
  );
}
