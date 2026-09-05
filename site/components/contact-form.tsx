"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const ROLES = ["broker", "brokerage", "crm", "portal", "other"] as const;
const FORMSPREE_ID = process.env.NEXT_PUBLIC_FORMSPREE_ID;
const TEAM_EMAIL = "team@sodar.io";
const PHONE = "+372 56666760";

/**
 * Contact form. Posts JSON to Formspree when NEXT_PUBLIC_FORMSPREE_ID is set;
 * until then it falls back to a pre-filled mailto so nothing is lost. The
 * "who are you" role is mandatory — it routes the message internally.
 */
export function ContactForm() {
  const t = useTranslations("Contact");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    if (!FORMSPREE_ID) {
      const subject = encodeURIComponent(`[${data.role}] ${data.company || data.name}`);
      const body = encodeURIComponent(`${data.name} (${data.role}, ${data.company || "-"})\n${data.email}\n\n${data.message}`);
      window.location.href = `mailto:${TEAM_EMAIL}?subject=${subject}&body=${body}`;
      setState("sent");
      return;
    }
    setState("sending");
    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...data, _subject: `[${data.role}] ${data.company || data.name}` }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      form.reset();
    } catch {
      setState("error");
    }
  }

  const input = "mt-1.5 w-full rounded-xl border border-border bg-bg px-3.5 py-3 text-sm text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none";

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
      <div>
        <p className="section-kicker">{t("eyebrow")}</p>
        <h2 className="section-title mt-7">{t("title")}</h2>
        <p className="mt-6 max-w-md text-text-muted">{t("sub")}</p>
        <dl className="mt-8 space-y-4 text-sm">
          <div>
            <dt className="mono-label">{t("phoneLabel")}</dt>
            <dd className="mt-1 text-lg text-text" dir="ltr"><a href={`tel:${PHONE.replace(/\s/g, "")}`} className="hover:underline">{PHONE}</a></dd>
          </div>
          <div>
            <dt className="mono-label">{t("emailLabel")}</dt>
            <dd className="mt-1 text-lg text-text" dir="ltr"><a href={`mailto:${TEAM_EMAIL}`} className="hover:underline">{TEAM_EMAIL}</a></dd>
          </div>
        </dl>
      </div>

      {state === "sent" ? (
        <div className="rounded-3xl border border-border-strong bg-bg-raised p-8">
          <p className="display text-3xl text-text">{t("sent")}</p>
          <p className="mt-3 text-text-muted">{t("sentBody")}</p>
          <button type="button" onClick={() => setState("idle")} className="button-secondary mt-6">{t("another")}</button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="rounded-3xl border border-border bg-bg-raised p-8">
          <fieldset>
            <legend className="text-xs text-text-muted">{t("roleLabel")} *</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ROLES.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2.5 text-sm text-text has-[:checked]:border-text">
                  <input type="radio" name="role" value={r} required className="accent-current" />
                  {t(`roles.${r}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-text-muted">
              {t("name")} *
              <input name="name" required autoComplete="name" className={input} />
            </label>
            <label className="block text-xs text-text-muted">
              {t("company")}
              <input name="company" autoComplete="organization" className={input} />
            </label>
          </div>
          <label className="mt-4 block text-xs text-text-muted">
            {t("email")} *
            <input name="email" type="email" required autoComplete="email" className={input} />
          </label>
          <label className="mt-4 block text-xs text-text-muted">
            {t("message")} *
            <textarea name="message" required rows={5} className={input} />
          </label>
          <label className="mt-4 flex items-start gap-2 text-xs text-text-muted">
            <input type="checkbox" name="consent" required className="mt-0.5 accent-current" />
            <span>{t("consent")}</span>
          </label>
          {state === "error" ? <p className="mt-4 text-sm text-text">{t("error")}</p> : null}
          <button type="submit" disabled={state === "sending"} className="button-primary mt-6 w-full justify-center">
            {state === "sending" ? t("sending") : t("submit")} <span aria-hidden>↗</span>
          </button>
          {!FORMSPREE_ID ? <p className="mt-2 text-center font-mono text-[10px] text-text-faint">{t("fallbackNote")}</p> : null}
        </form>
      )}
    </div>
  );
}
