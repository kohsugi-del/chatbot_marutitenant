"use client";
import { usePathname } from "next/navigation";
import FloatingChatLauncher from "@/components/FloatingChatLauncher";

export default function ClientWidgets() {
  const pathname = usePathname();
  if (pathname === "/embed") return null; // embedでは出さない

  return (
    <FloatingChatLauncher embedPath="/embed" />
  );
}
