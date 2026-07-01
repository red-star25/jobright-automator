"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

type MeResponse = {
  ok: boolean;
  email?: string;
  plan?: string;
  usage?: { rewrite: number; pro: number };
  limits?: { rewrite: number; pro: number };
  subscriptionStatus?: string;
};

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token || null;
      setSessionToken(token);
      if (!token) {
        setLoading(false);
        return;
      }
      fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.json())
        .then((json) => setMe(json))
        .finally(() => setLoading(false));
    });
  }, []);

  async function startCheckout() {
    if (!sessionToken) return;
    setMessage("");
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const json = await res.json();
    if (json.url) window.location.href = json.url;
    else setMessage(json.error || "Could not start checkout.");
  }

  async function openPortal() {
    if (!sessionToken) return;
    setMessage("");
    const res = await fetch("/api/me", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "portal" }),
    });
    const json = await res.json();
    if (json.url) window.location.href = json.url;
    else setMessage(json.error || "Could not open billing portal.");
  }

  async function signOut() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    setSessionToken(null);
    setMe(null);
    window.location.href = "/auth/sign-in";
  }

  if (loading) {
    return <main className="mx-auto max-w-2xl px-6 py-16">Loading...</main>;
  }

  if (!sessionToken) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-4 text-zinc-600">Sign in to view your plan and usage.</p>
        <Link href="/auth/sign-in" className="mt-6 inline-block rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white">
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="mt-2 text-zinc-600">{me?.email}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="shrink-0 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
        >
          Sign out
        </button>
      </div>

      <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm uppercase tracking-wide text-zinc-500">Current plan</p>
        <p className="mt-1 text-2xl font-semibold capitalize">{me?.plan || "free"}</p>
        <p className="mt-1 text-sm text-zinc-500">Status: {me?.subscriptionStatus || "none"}</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <UsageCard label="Rewrite" used={me?.usage?.rewrite || 0} limit={me?.limits?.rewrite || 0} />
          <UsageCard label="Rewrite Pro" used={me?.usage?.pro || 0} limit={me?.limits?.pro || 0} />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {me?.plan === "pro" ? (
            <button onClick={openPortal} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-50">
              Manage billing
            </button>
          ) : (
            <button onClick={startCheckout} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              Upgrade to Pro
            </button>
          )}
        </div>
        {message ? <p className="mt-4 text-sm text-red-600">{message}</p> : null}
      </div>

      <div className="mt-8 rounded-xl border border-emerald-100 bg-emerald-50 p-6 text-sm text-emerald-900">
        <p className="font-semibold">Chrome extension</p>
        <p className="mt-2">
          In InsiderReach Options, choose <strong>Cloud (InsiderReach)</strong> as your AI provider and sign in.
          Usage and billing are shared between this dashboard and the extension.
        </p>
      </div>

      <Link href="/" className="mt-8 inline-block text-sm text-zinc-500 hover:text-zinc-800">
        Back to home
      </Link>
    </main>
  );
}

function UsageCard({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-zinc-500">
          {used}/{limit}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
