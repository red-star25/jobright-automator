import { redirect } from "next/navigation";

export default async function ExtensionStartPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const params = await searchParams;
  const extRedirect = params.redirect;
  if (!extRedirect) {
    redirect("/auth/sign-in");
  }
  redirect(`/auth/sign-in?ext_redirect=${encodeURIComponent(extRedirect)}`);
}
