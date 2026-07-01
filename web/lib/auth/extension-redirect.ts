const STORAGE_KEY = "ir_ext_redirect";
const COOKIE_KEY = "ir_ext_redirect";

export function saveExtensionRedirect(extRedirect: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, extRedirect);
  localStorage.setItem(STORAGE_KEY, extRedirect);
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(extRedirect)}; path=/; max-age=600; samesite=lax`;
}

export function readExtensionRedirect(fallback?: string | null) {
  if (typeof window === "undefined") return fallback || null;

  const fromSession = sessionStorage.getItem(STORAGE_KEY);
  if (fromSession) return fromSession;

  const fromLocal = localStorage.getItem(STORAGE_KEY);
  if (fromLocal) return fromLocal;

  const cookieMatch = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`)
  );
  if (cookieMatch?.[1]) {
    try {
      return decodeURIComponent(cookieMatch[1]);
    } catch {
      return cookieMatch[1];
    }
  }

  return fallback || null;
}

export function clearExtensionRedirect() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; samesite=lax`;
}

export function extensionCallbackUrl(origin: string, extRedirect?: string | null) {
  const url = new URL("/auth/extension-callback", origin);
  if (extRedirect) {
    url.searchParams.set("ext_redirect", extRedirect);
  }
  return url.toString();
}
