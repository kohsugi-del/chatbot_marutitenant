import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

// GET /api/client-config?client_id=xxx
// テナントDBからClientConfig形式で返す
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId || !ADMIN_SECRET) return NextResponse.json(null, { status: 404 });

  try {
    const res = await fetch(`${API_BASE}/tenants`, {
      headers: { "X-Admin-Secret": ADMIN_SECRET },
    });
    if (!res.ok) return NextResponse.json(null, { status: 404 });

    const tenants = await res.json();
    const tenant = tenants.find((t: { client_id?: string }) => t.client_id === clientId);
    if (!tenant) return NextResponse.json(null, { status: 404 });

    const config = {
      clientId: tenant.client_id ?? clientId,
      categoryPrompt: "",
      emergencyKeywords: tenant.emergency_keywords
        ? JSON.parse(tenant.emergency_keywords)
        : [],
      topicKeywords: tenant.topic_keywords
        ? JSON.parse(tenant.topic_keywords)
        : [],
      phoneNumbers: {
        normal: tenant.phone_normal ?? "",
        emergency: tenant.phone_emergency ?? "",
      },
      businessHours: tenant.business_hours ?? "",
    };

    return NextResponse.json(config);
  } catch {
    return NextResponse.json(null, { status: 500 });
  }
}
