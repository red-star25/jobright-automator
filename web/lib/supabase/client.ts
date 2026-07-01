import { createClient } from "@supabase/supabase-js";

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase client environment variables");
  }
  return { url, key };
}

export function createBrowserClient() {
  const { url, key } = getSupabaseEnv();
  return createClient(url, key, {
    auth: {
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
}

/** Implicit flow — required for Chrome extension OAuth popups (PKCE verifier is lost across Google redirect). */
export function createExtensionOAuthClient() {
  const { url, key } = getSupabaseEnv();
  return createClient(url, key, {
    auth: {
      detectSessionInUrl: true,
      flowType: "implicit",
      persistSession: false,
    },
  });
}
