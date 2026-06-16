import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

function adminHeaders() {
  return {
    "X-Admin-Secret": ADMIN_SECRET,
    "Content-Type": "application/json",
  };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ADMIN_SECRET) {
    return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 503 });
  }
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${API_BASE}/tenants/${id}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ADMIN_SECRET) {
    return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 503 });
  }
  const { id } = await params;
  const res = await fetch(`${API_BASE}/tenants/${id}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
