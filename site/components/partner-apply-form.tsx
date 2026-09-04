"use client";

// TODO(phase-2): real submission, stored + reviewed server-side.
export function PartnerApplyForm() {
  return (
    <form className="rounded-3xl border border-border bg-bg-raised p-8" onSubmit={(e) => e.preventDefault()}>
      <label className="block text-xs text-text-muted">Company / platform name</label>
      <input className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3.5 py-3 text-sm focus:border-accent/50 focus:outline-none" placeholder="Acme CRM" />
      <label className="mt-4 block text-xs text-text-muted">Work email</label>
      <input type="email" className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3.5 py-3 text-sm focus:border-accent/50 focus:outline-none" placeholder="you@company.com" />
      <label className="mt-4 block text-xs text-text-muted">Active brokers on your platform</label>
      <input className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3.5 py-3 text-sm focus:border-accent/50 focus:outline-none" placeholder="e.g. 50–200" />
      <button type="submit" className="button-primary mt-6 w-full justify-center">Submit application <span>↗</span></button>
    </form>
  );
}
