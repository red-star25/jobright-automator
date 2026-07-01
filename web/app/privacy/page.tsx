export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 prose prose-zinc">
      <h1>Privacy Policy</h1>
      <p>
        InsiderReach helps you prepare Jobright outreach messages. When you use Cloud AI, message text, job context,
        and resume text for Rewrite Pro are sent to our servers to generate rewrites. We do not store full resume or
        message content in long-term logs beyond short-lived processing and optional response caching hashes.
      </p>
      <p>
        Outreach logs, uploaded resume PDFs, and Gmail/LinkedIn automation state remain stored locally in your Chrome
        browser unless you choose to sync them in a future product version.
      </p>
      <p>
        Billing is handled by Stripe. Authentication is handled by Supabase. OpenAI processes AI requests on our behalf
        when you use Cloud AI.
      </p>
    </main>
  );
}
