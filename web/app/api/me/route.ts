import { NextRequest, NextResponse } from "next/server";
import { cloudApiRequest, normalizeCloudMe, type CloudMeResponse } from "@/lib/cloud-api";
import { getUserFromBearerToken } from "@/lib/supabase/server-auth";

export async function GET(request: NextRequest) {
  const user = await getUserFromBearerToken(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const token = request.headers.get("authorization")!.slice("Bearer ".length).trim();
  const result = await cloudApiRequest<CloudMeResponse>("/v1/me", token);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: "CLOUD_API_ERROR" },
      { status: result.status }
    );
  }

  return NextResponse.json(normalizeCloudMe(result.data));
}

export async function POST(request: NextRequest) {
  const user = await getUserFromBearerToken(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.action !== "portal") {
    return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
  }

  const token = request.headers.get("authorization")!.slice("Bearer ".length).trim();
  const result = await cloudApiRequest<{ ok: boolean; url?: string }>("/v1/stripe/portal", token, {
    method: "POST",
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, url: result.data.url });
}
