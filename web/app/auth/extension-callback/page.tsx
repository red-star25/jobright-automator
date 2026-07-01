"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  clearExtensionRedirect,
  readExtensionRedirect,
  saveExtensionRedirect,
} from "@/lib/auth/extension-redirect";
import { createBrowserClient } from "@/lib/supabase/client";

async function waitForSession(maxMs = 12000): Promise<Session | null> {
  const supabase = createBrowserClient();
  const started = Date.now();

  while (Date.now() - started < maxMs) {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session) return data.session;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return null;
}

function ExtensionCallbackInner() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Completing sign in...");
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    async function finish() {
      const extRedirectFromQuery = searchParams.get("ext_redirect");
      if (extRedirectFromQuery) saveExtensionRedirect(extRedirectFromQuery);
      const extRedirect = extRedirectFromQuery || readExtensionRedirect();

      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const hashParams = new URLSearchParams(hash);
      const hashAccessToken = hashParams.get("access_token");
      const hashRefreshToken = hashParams.get("refresh_token");
      const hashExpiresIn = hashParams.get("expires_in");

      if (hashAccessToken && hashRefreshToken) {
        redirectToExtension(
          extRedirect,
          hashAccessToken,
          hashRefreshToken,
          hashExpiresIn
        );
        return;
      }

      const session = await waitForSession();
      if (!session) {
        setMessage("Could not complete sign in. Close this tab and try again from the extension.");
        return;
      }

      redirectToExtension(
        extRedirect,
        session.access_token,
        session.refresh_token,
        String(session.expires_in || 3600)
      );
    }

    function redirectToExtension(
      extRedirect: string | null,
      accessToken: string,
      refreshToken: string,
      expiresIn: string | null
    ) {
      if (!extRedirect) {
        clearExtensionRedirect();
        window.location.href = "/dashboard";
        return;
      }

      const expiresAt = Math.floor(Date.now() / 1000) + Number(expiresIn || 3600);
      const target = new URL(extRedirect);
      target.hash = new URLSearchParams({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: String(expiresAt),
      }).toString();
      clearExtensionRedirect();
      window.location.href = target.toString();
    }

    finish();
  }, [searchParams]);

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-xl font-semibold">InsiderReach sign in</h1>
      <p className="mt-4 text-sm text-zinc-600">{message}</p>
    </main>
  );
}

export default function ExtensionCallbackPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-6 py-16">Loading...</main>}>
      <ExtensionCallbackInner />
    </Suspense>
  );
}
