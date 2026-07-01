"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

function ExtensionCallbackInner() {
  const searchParams = useSearchParams();
  const extRedirect = searchParams.get("ext_redirect");
  const [message, setMessage] = useState("Completing sign in...");

  useEffect(() => {
    const supabase = createBrowserClient();

    async function finish() {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const expiresIn = hashParams.get("expires_in");

      if (accessToken && refreshToken) {
        redirectToExtension(accessToken, refreshToken, expiresIn);
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setMessage("Could not complete sign in. Close this tab and try again from the extension.");
        return;
      }

      redirectToExtension(
        data.session.access_token,
        data.session.refresh_token,
        String(data.session.expires_in || 3600)
      );
    }

    function redirectToExtension(accessToken: string, refreshToken: string, expiresIn: string | null) {
      if (!extRedirect) {
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
      window.location.href = target.toString();
    }

    finish();
  }, [extRedirect]);

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
