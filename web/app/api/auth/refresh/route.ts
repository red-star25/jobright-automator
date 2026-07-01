import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ ok: false, error: "Auth is not configured." }, { status: 503 });
  }

  let body: { refresh_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const refreshToken = body.refresh_token?.trim();
  if (!refreshToken) {
    return NextResponse.json({ ok: false, error: "Missing refresh_token." }, { status: 400 });
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Could not refresh session.", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    email: data.session.user.email,
  });
}
