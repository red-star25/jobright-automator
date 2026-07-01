import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const extRedirect = request.nextUrl.searchParams.get("redirect");
  if (!extRedirect) {
    return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  }

  const signInUrl = new URL("/auth/sign-in", request.url);
  signInUrl.searchParams.set("ext_redirect", extRedirect);

  const response = NextResponse.redirect(signInUrl);
  response.cookies.set("ir_ext_redirect", extRedirect, {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
