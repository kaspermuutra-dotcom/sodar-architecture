"use client";

import { useTranslations } from "next-intl";

// TODO(phase-2): real submission, stored + reviewed server-side.
export function PartnerApplyForm() {
  const t = useTranslations("PartnersPage.form");
  const input = "mt-1.5 w-full rounded-xl border border-border bg-bg px-3.5 py-3 text-sm focus:border-border-strong focus:outline-none";
  return (
    <form className="rounded-3xl border border-border bg-bg-raised p-8" onSubmit={(e) => e.preventDefault()}>
      <label className="block text-xs text-text-muted">
        {t("company")}
        <input className={input} placeholder={t("companyPh")} />
      </label>
      <label className="mt-4 block text-xs text-text-muted">
        {t("email")}
        <input type="email" className={input} placeholder={t("emailPh")} />
      </label>
      <label className="mt-4 block text-xs text-text-muted">
        {t("brokers")}
        <input className={input} placeholder={t("brokersPh")} />
      </label>
      <button type="submit" className="button-primary mt-6 w-full justify-center">
        {t("submit")} <span aria-hidden>↗</span>
      </button>
    </form>
  );
}
