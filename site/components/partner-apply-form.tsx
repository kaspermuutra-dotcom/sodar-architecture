"use client";

import { useTranslations } from "next-intl";

// TODO(phase-2): real submission, stored + reviewed server-side.
export function PartnerApplyForm() {
  const t = useTranslations("PartnersPage.form");
  const input = "field-input";
  return (
    <form className="rounded-2xl border border-border bg-bg-raised p-8" onSubmit={(e) => e.preventDefault()}>
      <label className="field">
        {t("company")}
        <input className={input} placeholder={t("companyPh")} />
      </label>
      <label className="field mt-4">
        {t("email")}
        <input type="email" className={input} placeholder={t("emailPh")} />
      </label>
      <label className="field mt-4">
        {t("brokers")}
        <input className={input} placeholder={t("brokersPh")} />
      </label>
      <button type="submit" className="button-primary mt-6 w-full">
        {t("submit")}
      </button>
    </form>
  );
}
