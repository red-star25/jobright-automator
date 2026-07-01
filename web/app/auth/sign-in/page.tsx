"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  extensionCallbackUrl,
  saveExtensionRedirect,
} from "@/lib/auth/extension-redirect";
import { createBrowserClient } from "@/lib/supabase/client";

function SignInForm() {
  const searchParams = useSearchParams();
  const extRedirect = searchParams.get("ext_redirect");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (extRedirect) saveExtensionRedirect(extRedirect);
  }, [extRedirect]);

  function oauthRedirectTo() {
    if (extRedirect) return extensionCallbackUrl(window.location.origin, extRedirect);
    return `${window.location.origin}/dashboard`;
  }

  async function signInWithGoogle() {
    setLoading(true);
    setMessage("");
    const supabase = createBrowserClient();
    if (!extRedirect) await supabase.auth.signOut();
    if (extRedirect) saveExtensionRedirect(extRedirect);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: oauthRedirectTo(),
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setMessage(error.message);
      setLoading(false);
    }
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const supabase = createBrowserClient();
    if (!extRedirect) await supabase.auth.signOut();
    if (extRedirect) saveExtensionRedirect(extRedirect);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: oauthRedirectTo() },
    });
    setLoading(false);
    if (error) setMessage(error.message);
    else setMessage("Check your email for a magic link.");
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold">Sign in to InsiderReach</h1>
      <p className="mt-2 text-sm text-zinc-600">
        {extRedirect ? "Sign in to connect Cloud AI to the Chrome extension." : "Access your dashboard and Cloud AI usage."}
      </p>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={loading}
        className="mt-8 w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
      >
        Continue with Google
      </button>

      <form onSubmit={signInWithEmail} className="mt-6 space-y-3">
        <label className="block text-sm font-medium" htmlFor="email">
          Email magic link
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          placeholder="you@example.com"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          Email me a link
        </button>
      </form>

      {message ? <p className="mt-4 text-sm text-zinc-600">{message}</p> : null}

      <Link href="/" className="mt-8 inline-block text-sm text-zinc-500 hover:text-zinc-800">
        Back to home
      </Link>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-6 py-16">Loading...</main>}>
      <SignInForm />
    </Suspense>
  );
}
