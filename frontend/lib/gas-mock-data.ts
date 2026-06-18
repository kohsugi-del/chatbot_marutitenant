// =============================================
// ガス会社向けダッシュボード用モックデータ
// =============================================

export interface MonthlyStats {
  totalConversations: number
  escalationRate: number
  resolvedCount: number
  emergencyKeywordCount: number
}

export interface ConversationTrend {
  month: string
  count: number
}

export interface HeatmapData {
  dayOfWeek: number
  hour: number
  count: number
}

export interface TopQuestion {
  content: string
  count: number
}

export interface TopDoc {
  title: string
  source: string
  url: string
  referenceCount: number
  lastReferencedAt: string
}

export interface UnusedDoc {
  title: string
  source: string
  url: string
  lastReferencedAt: string | null
}

export interface EmergencyKeyword {
  keyword: string
  count: number
  date: string
}

export interface ModeHistory {
  mode: string
  startedAt: string
  endedAt: string | null
}

export interface TopicDistribution {
  label: string
  value: number
}

export interface DailyEmergencyTrend {
  date: string
  count: number
}

export interface GasDashboardProps {
  clientId: string
  monthlyStats: MonthlyStats
  conversationTrend: ConversationTrend[]
  heatmapData: HeatmapData[]
  topQuestions: TopQuestion[]
  topDocs: TopDoc[]
  unusedDocs: UnusedDoc[]
  emergencyKeywords: EmergencyKeyword[]
  modeHistory: ModeHistory[]
  topicDistribution: TopicDistribution[]
  dailyEmergencyTrend: DailyEmergencyTrend[]
  reportMonth: string
  reportYear: number
}

function generateHeatmapData(): HeatmapData[] {
  const data: HeatmapData[] = []
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const isWeekend = day === 0 || day === 6
      const isBusinessHour = hour >= 9 && hour <= 18
      const base = isWeekend ? 5 : isBusinessHour ? 25 : 8
      const noise = (day * 7 + hour * 3) % 13
      data.push({ dayOfWeek: day, hour, count: base + noise })
    }
  }
  return data
}

function generateConversationTrend(): ConversationTrend[] {
  return [
    { month: "2025/10", count: 2340 },
    { month: "2025/11", count: 2580 },
    { month: "2025/12", count: 2890 },
    { month: "2026/01", count: 2720 },
    { month: "2026/02", count: 2950 },
    { month: "2026/03", count: 3120 },
  ]
}

function generateDailyEmergencyTrend(): DailyEmergencyTrend[] {
  const data: DailyEmergencyTrend[] = []
  for (let i = 1; i <= 28; i++) {
    const count = (i % 7 === 0 ? 0 : 1) + (i * 3) % 5
    data.push({ date: `3/${i}`, count })
  }
  return data
}

function generateEmergencyKeywords(): EmergencyKeyword[] {
  return [
    { keyword: "ガス漏れ", count: 5, date: "2026-03-05" },
    { keyword: "ガス漏れ", count: 3, date: "2026-03-12" },
    { keyword: "ガス漏れ", count: 4, date: "2026-03-18" },
    { keyword: "異臭", count: 2, date: "2026-03-07" },
    { keyword: "異臭", count: 3, date: "2026-03-15" },
    { keyword: "異臭", count: 3, date: "2026-03-22" },
    { keyword: "一酸化炭素", count: 1, date: "2026-03-10" },
    { keyword: "一酸化炭素", count: 2, date: "2026-03-20" },
    { keyword: "火災", count: 1, date: "2026-03-08" },
    { keyword: "火災", count: 1, date: "2026-03-25" },
    { keyword: "爆発", count: 1, date: "2026-03-14" },
  ]
}

function generateModeHistory(): ModeHistory[] {
  return [
    { mode: "緊急", startedAt: "2026-03-05T14:23:00", endedAt: "2026-03-05T16:45:00" },
    { mode: "緊急", startedAt: "2026-03-12T09:15:00", endedAt: "2026-03-12T11:30:00" },
    { mode: "緊急", startedAt: "2026-03-18T22:10:00", endedAt: "2026-03-19T01:00:00" },
  ]
}

export const mockGasDashboard: GasDashboardProps = {
  clientId: "default",
  reportMonth: "3",
  reportYear: 2026,
  monthlyStats: {
    totalConversations: 3120,
    escalationRate: 8.5,
    resolvedCount: 2855,
    emergencyKeywordCount: 26,
  },
  conversationTrend: generateConversationTrend(),
  heatmapData: generateHeatmapData(),
  topQuestions: [
    { content: "ガスの開栓手続きについて教えてください", count: 245 },
    { content: "ガス料金の支払い方法を変更したい", count: 198 },
    { content: "引っ越しの際のガス閉栓手続きは？", count: 167 },
    { content: "ガス給湯器のエラーコードE-110の対処法", count: 134 },
    { content: "ガス漏れ警報器が鳴った場合の対応", count: 112 },
    { content: "ガス機器の点検予約をしたい", count: 98 },
    { content: "業務用ガス契約への変更方法", count: 87 },
    { content: "ガスコンロの火がつかない", count: 76 },
  ],
  topDocs: [
    { title: "ガス開栓・閉栓手続きガイド", source: "manual", url: "#", referenceCount: 412, lastReferencedAt: "2026-03-28T15:30:00" },
    { title: "ガス料金のお支払い方法", source: "faq", url: "#", referenceCount: 356, lastReferencedAt: "2026-03-28T14:22:00" },
    { title: "ガス機器エラーコード一覧", source: "manual", url: "#", referenceCount: 287, lastReferencedAt: "2026-03-28T16:45:00" },
    { title: "緊急時の対応マニュアル", source: "manual", url: "#", referenceCount: 234, lastReferencedAt: "2026-03-28T12:10:00" },
    { title: "業務用ガス契約のご案内", source: "brochure", url: "#", referenceCount: 156, lastReferencedAt: "2026-03-27T11:00:00" },
  ],
  unusedDocs: [
    { title: "旧型ガスメーター取扱説明書", source: "manual", url: "#", lastReferencedAt: "2025-08-15T10:00:00" },
    { title: "2020年度料金改定のお知らせ", source: "notice", url: "#", lastReferencedAt: "2024-12-01T09:00:00" },
    { title: "廃止サービスに関するFAQ", source: "faq", url: "#", lastReferencedAt: null },
  ],
  emergencyKeywords: generateEmergencyKeywords(),
  modeHistory: generateModeHistory(),
  topicDistribution: [
    { label: "ご家庭のお客様", value: 32 },
    { label: "業務用のお客様", value: 18 },
    { label: "ガスの開栓・閉栓", value: 22 },
    { label: "ガス機器", value: 15 },
    { label: "会社・採用", value: 5 },
    { label: "その他", value: 8 },
  ],
  dailyEmergencyTrend: generateDailyEmergencyTrend(),
}

export function calculateEscalationCount(stats: MonthlyStats): number {
  return Math.round(stats.totalConversations * (stats.escalationRate / 100))
}

export function aggregateEmergencyByKeyword(keywords: EmergencyKeyword[]): { keyword: string; total: number }[] {
  const map = new Map<string, number>()
  keywords.forEach((k) => { map.set(k.keyword, (map.get(k.keyword) || 0) + k.count) })
  return Array.from(map.entries()).map(([keyword, total]) => ({ keyword, total })).sort((a, b) => b.total - a.total)
}

export function calculateModeDuration(history: ModeHistory): string {
  if (!history.endedAt) return "継続中"
  const diffMs = new Date(history.endedAt).getTime() - new Date(history.startedAt).getTime()
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}時間${minutes}分`
}

export function formatDateTime(isoString: string): string {
  const d = new Date(isoString)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`
}
