import Link from "next/link";
import { PLANS } from "@/lib/billing/plans";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">InsiderReach</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">Referral outreach, faster.</h1>
        <p className="mt-4 text-lg text-zinc-600">
          Automate Jobright Insider Connection prep: Gmail drafts with your resume attached and LinkedIn notes
          ready to review. You still click Send on every message.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(["free", "pro"] as const).map((planId) => {
          const plan = PLANS[planId];
          return (
            <div key={planId} className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">{plan.label}</h2>
              <p className="mt-2 text-3xl font-bold">
                {plan.priceMonthlyUsd ? `$${plan.priceMonthlyUsd}/mo` : "Free"}
              </p>
              <ul className="mt-4 space-y-2 text-sm text-zinc-600">
                <li>{plan.rewritePerMonth} Rewrite requests / month</li>
                <li>{plan.proPerMonth} Rewrite Pro requests / month</li>
                <li>Cloud AI — no OpenAI key required</li>
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/dashboard"
          className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Open dashboard
        </Link>
        <Link href="/auth/sign-in" className="rounded-lg border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold hover:bg-zinc-50">
          Sign in
        </Link>
      </div>

      <footer className="mt-16 border-t border-zinc-200 pt-6 text-sm text-zinc-500">
        <Link href="/privacy" className="mr-4 hover:text-zinc-800">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-zinc-800">
          Terms
        </Link>
      </footer>
    </main>
  );
}
