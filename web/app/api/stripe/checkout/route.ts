import { NextRequest, NextResponse } from "next/server";
import { cloudApiRequest } from "@/lib/cloud-api";
import { getUserFromBearerToken } from "@/lib/supabase/server-auth";

export async function POST(request: NextRequest) {
  const user = await getUserFromBearerToken(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const token = request.headers.get("authorization")!.slice("Bearer ".length).trim();
  const result = await cloudApiRequest<{ ok: boolean; url?: string }>("/v1/stripe/checkout", token, {
    method: "POST",
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, url: result.data.url });
}
