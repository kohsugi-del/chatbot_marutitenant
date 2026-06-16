import type { ClientConfig } from "@/types/log";

export const clientConfig: ClientConfig = {
  clientId: "qwest",
  categoryPrompt: `
以下のテキストは「normal」「emergency」「both」のどれですか？
1単語のみで答えてください。

emergency = 災害・避難・緊急連絡・危険に関する内容
normal    = それ以外の通常案内
  `,
  emergencyKeywords: ["火災", "避難", "緊急"],
  topicKeywords: [],
  phoneNumbers: {
    normal: "0120-XXX-XXX",
    emergency: "0120-XXX-XXX",
  },
  businessHours: "平日 9:00〜17:00",
};
