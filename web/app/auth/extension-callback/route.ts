import { NextRequest, NextResponse } from "next/server";

function escapeJsString(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/</g, "\\x3c");
}

function extensionCallbackHtml(extRedirect: string | null) {
  const extRedirectJs = extRedirect ? `"${escapeJsString(extRedirect)}"` : "null";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>InsiderReach sign in</title>
  <script>
    (function () {
      var extRedirect = ${extRedirectJs};

      function finishToExtension(accessToken, refreshToken, expiresIn) {
        if (!extRedirect) {
          window.location.replace("/dashboard");
          return;
        }
        var expiresAt = Math.floor(Date.now() / 1000) + Number(expiresIn || 3600);
        var target = new URL(extRedirect);
        target.hash = new URLSearchParams({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: String(expiresAt),
        }).toString();
        window.location.replace(target.toString());
      }

      var hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      if (hash) {
        var hashParams = new URLSearchParams(hash);
        var accessToken = hashParams.get("access_token");
        var refreshToken = hashParams.get("refresh_token");
        if (accessToken && refreshToken) {
          finishToExtension(accessToken, refreshToken, hashParams.get("expires_in"));
          return;
        }
      }

      document.addEventListener("DOMContentLoaded", function () {
        document.getElementById("status").textContent =
          "Could not complete sign in. Close this tab and try again from the extension.";
      });
    })();
  </script>
</head>
<body>
  <p id="status">Completing sign in...</p>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  const extRedirect =
    request.nextUrl.searchParams.get("ext_redirect") ||
    request.cookies.get("ir_ext_redirect")?.value ||
    null;

  return new NextResponse(extensionCallbackHtml(extRedirect), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
