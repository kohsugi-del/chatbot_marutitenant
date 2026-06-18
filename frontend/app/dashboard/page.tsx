"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Building2, Download } from "lucide-react"
import Link from "next/link"
import type { GasDashboardProps } from "@/lib/gas-mock-data"
import { GasKpiCards } from "@/components/gas-dashboard/gas-kpi-cards"
import { PhoneEscalationCard } from "@/components/gas-dashboard/phone-escalation-card"
import { ConversationTrendChart } from "@/components/gas-dashboard/conversation-trend-chart"
import { HeatmapChart } from "@/components/gas-dashboard/heatmap-chart"
import { EmergencyKeywords } from "@/components/gas-dashboard/emergency-keywords"
import { TopicDistributionChart } from "@/components/gas-dashboard/distribution-charts"
import { TopQuestionsList, TopDocsList, UnusedDocsList } from "@/components/gas-dashboard/docs-lists"
import { SavingsWidget } from "@/components/gas-dashboard/savings-widget"
import { ModeHistoryList } from "@/components/gas-dashboard/mode-history"

const YEARS = [2024, 2025, 2026]
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const CLIENT_ID = process.env.NEXT_PUBLIC_CLIENT_ID ?? "default"

// /api/dashboard/stats のレスポンス型
type StatsResponse = {
  summary: {
    total_count: number
    escalated_count: number
    resolved_count: number
    escalation_rate: number
    resolution_rate: number
  }
  monthly_trend: { month: string; count: number }[]
  heatmap: { day_of_week: number; hour: number; count: number }[]
  top_questions: { content: string; count: number }[]
  top_docs: { title: string; source_url: string; reference_count: number; last_referenced_at: string }[]
  unused_docs: { id: string; title: string; url: string | null; source_url: string | null; updated_at: string | null; last_crawled_at: string | null }[]
  keyword_stats: { keyword: string; count: number }[]
  category_distribution: { category: string; count: number; percentage: number }[]
  mode_history: { mode: string; started_at: string; ended_at: string | null }[]
  daily_emergency_trend: { date: string; count: number }[]
}

function mapToProps(res: StatsResponse, year: number, month: number): GasDashboardProps {
  const pad = String(month).padStart(2, "0")
  const emergencyKeywordCount = res.keyword_stats.reduce((s, k) => s + k.count, 0)

  return {
    clientId: CLIENT_ID,
    reportYear: year,
    reportMonth: String(month),
    monthlyStats: {
      totalConversations: res.summary.total_count,
      escalationRate: res.summary.escalation_rate,
      resolvedCount: res.summary.resolved_count,
      emergencyKeywordCount,
    },
    // YYYY-MM → YYYY/MM に変換（グラフ軸ラベル用）
    conversationTrend: res.monthly_trend.map((t) => ({
      month: t.month.replace("-", "/"),
      count: t.count,
    })),
    heatmapData: res.heatmap.map((h) => ({
      dayOfWeek: h.day_of_week,
      hour: h.hour,
      count: h.count,
    })),
    topQuestions: res.top_questions,
    topDocs: res.top_docs.map((d) => ({
      title: d.title ?? "(無題)",
      source: d.source_url ?? "",
      url: d.source_url ?? "#",
      referenceCount: d.reference_count,
      lastReferencedAt: d.last_referenced_at,
    })),
    unusedDocs: res.unused_docs.map((d) => ({
      title: d.title ?? "(無題)",
      source: d.url ?? d.source_url ?? "",
      url: d.url ?? d.source_url ?? "#",
      lastReferencedAt: d.updated_at ?? d.last_crawled_at,
    })),
    // keyword_stats（集計済み）を EmergencyKeywords コンポーネントの期待する形式に変換
    emergencyKeywords: res.keyword_stats.map((k) => ({
      keyword: k.keyword,
      count: k.count,
      date: `${year}-${pad}-01`,
    })),
    modeHistory: res.mode_history.map((m) => ({
      mode: m.mode === "emergency" ? "緊急" : m.mode === "notice" ? "注意報" : m.mode,
      startedAt: m.started_at,
      endedAt: m.ended_at,
    })),
    topicDistribution: res.category_distribution.map((c) => ({
      label: c.category,
      value: Math.round(c.percentage * 10) / 10,
    })),
    dailyEmergencyTrend: res.daily_emergency_trend,
  }
}

export default function DashboardPage() {
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<GasDashboardProps | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/dashboard/stats?year=${selectedYear}&month=${selectedMonth}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as StatsResponse
        setData(mapToProps(json, selectedYear, selectedMonth))
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [selectedYear, selectedMonth])

  const handleCsvDownload = () => {
    if (!data) return
    const csvRows: (string | number)[][] = [
      ["項目", "値"],
      ["対象年月", `${selectedYear}年${selectedMonth}月`],
      ["総会話数", data.monthlyStats.totalConversations],
      ["AI解決件数", data.monthlyStats.resolvedCount],
      ["電話誘導率", `${data.monthlyStats.escalationRate}%`],
      ["緊急ワード検知件数", data.monthlyStats.emergencyKeywordCount],
      [],
      ["トピック分布"],
      ...data.topicDistribution.map((t) => [t.label, `${t.value}%`]),
      [],
      ["よくある質問TOP8"],
      ...data.topQuestions.map((q, i) => [`${i + 1}. ${q.content}`, q.count]),
      [],
      ["参照ドキュメントTOP5"],
      ...data.topDocs.map((d, i) => [`${i + 1}. ${d.title}`, d.referenceCount]),
    ]
    const csvContent = csvRows.map((row) => row.join(",")).join("\n")
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `AIチャットボット_${selectedYear}年${selectedMonth}月度.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              href="/"
              className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              管理ダッシュボードに戻る
            </Link>
            <h1 className="text-xl font-bold text-foreground tracking-tight">AIチャットボット運用ダッシュボード</h1>
            <p className="mt-1 text-sm text-muted-foreground">月次運用レポート</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-xs">
              <Building2 className="h-3 w-3" />
              {CLIENT_ID}
            </Badge>
            <div className="flex items-center gap-1">
              <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                <SelectTrigger className="h-7 w-[80px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={y.toString()}>{y}年</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
                <SelectTrigger className="h-7 w-[70px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m} value={m.toString()}>{m}月</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleCsvDownload}
              disabled={!data || loading}
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </div>

        {/* ローディング */}
        {loading && (
          <div className="mt-6 flex items-center justify-center py-20 text-sm text-muted-foreground">
            読み込み中…
          </div>
        )}

        {/* エラー */}
        {!loading && error && (
          <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            データ取得に失敗しました: {error}
          </div>
        )}

        {/* Main Content */}
        {!loading && data && (
          <div className="mt-6 flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="sm:col-span-3">
                <GasKpiCards data={data} />
              </div>
              <div>
                <PhoneEscalationCard data={data} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <ConversationTrendChart data={data.conversationTrend} />
              <HeatmapChart data={data.heatmapData} />
            </div>

            <EmergencyKeywords data={data} />

            <TopicDistributionChart data={data.topicDistribution} />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <TopQuestionsList questions={data.topQuestions} />
              <TopDocsList docs={data.topDocs} />
            </div>

            <UnusedDocsList docs={data.unusedDocs} />

            <SavingsWidget resolvedCount={data.monthlyStats.resolvedCount} />

            <ModeHistoryList history={data.modeHistory} />
          </div>
        )}

        <footer className="mt-8 border-t border-border/40 pt-4 pb-6">
          <p className="text-center text-xs text-muted-foreground">
            {`${selectedYear}年${selectedMonth}月度 月次運用レポート | AIチャットボット | CONFIDENTIAL`}
          </p>
        </footer>
      </div>
    </div>
  )
}
