"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DIAL_CODES, flagOf, normalisePhone } from "@/lib/dial-codes";
import { LINKEDIN_URL, PHONE, PRIVACY_EMAIL, TEAM_EMAIL } from "@/lib/company";

type Audience = "team" | "privacy";
const TOPICS = ["pilot", "pricing", "partnership", "careers", "other"] as const;

const FORMSPREE: Record<Audience, string | undefined> = {
  team: process.env.NEXT_PUBLIC_FORMSPREE_ID,
  privacy: process.env.NEXT_PUBLIC_FORMSPREE_PRIVACY_ID,
};
const TO: Record<Audience, string> = { team: TEAM_EMAIL, privacy: PRIVACY_EMAIL };

/**
 * Contact form. `audience="team"` (default) reaches team@sodar.io — hiring,
 * partnerships, sales; `audience="privacy"` reaches privacy@sodar.io and is
 * used on the privacy policy page only. Both post JSON to their Formspree
 * form when the id is set; until then they fall back to a pre-filled mailto
 * so nothing is lost. Job title, phone, subject and message are mandatory.
 */
export function ContactForm({ audience = "team" }: { audience?: Audience }) {
  const t = useTranslations("Contact");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [dial, setDial] = useState("+372");
  const formId = FORMSPREE[audience];
  const to = TO[audience];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    const phone = normalisePhone(raw.dial, raw.phone);
    const data = { ...raw, phone, audience };
    const subject = `[${audience === "privacy" ? "privacy" : raw.topic || "contact"}] ${raw.subject}`;
    if (!formId) {
      const body = [
        `${raw.name} · ${raw.jobTitle}${raw.company ? ` · ${raw.company}` : ""}`,
        ...(raw.topic ? [`Topic: ${raw.topic}`] : []),
        raw.email,
        phone,
        "",
        raw.message,
      ].join("\n");
      window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      setState("sent");
      return;
    }
    setState("sending");
    try {
      const res = await fetch(`https://formspree.io/f/${formId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...data, _subject: subject }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      form.reset();
      setDial("+372");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
      <div>
        <p className="section-kicker">{t(audience === "privacy" ? "privacyEyebrow" : "eyebrow")}</p>
        <h2 className="section-title mt-6">{t(audience === "privacy" ? "privacyTitle" : "title")}</h2>
        <p className="mt-6 max-w-md text-text-muted">{t(audience === "privacy" ? "privacySub" : "sub")}</p>
        <dl className="mt-10 space-y-5 text-sm">
          <div>
            <dt className="mono-label">{t("emailLabel")}</dt>
            <dd className="mt-1.5 text-lg text-text" dir="ltr">
              <a href={`mailto:${to}`} className="hover:underline">{to}</a>
            </dd>
          </div>
          {audience === "team" ? (
            <>
              <div>
                <dt className="mono-label">{t("phoneLabel")}</dt>
                <dd className="mt-1.5 text-lg text-text" dir="ltr">
                  <a href={`tel:${PHONE.replace(/\s/g, "")}`} className="hover:underline">{PHONE}</a>
                </dd>
              </div>
              <div>
                <dt className="mono-label">LinkedIn</dt>
                <dd className="mt-1.5 text-lg text-text">
                  <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {t("linkedin")}
                  </a>
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>

      {state === "sent" ? (
        <div className="rounded-2xl border border-border bg-bg-raised p-8">
          <p className="display text-3xl text-text">{t("sent")}</p>
          <p className="mt-3 text-text-muted">{t("sentBody")}</p>
          <button type="button" onClick={() => setState("idle")} className="button-secondary mt-8">{t("another")}</button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-bg-raised p-8" noValidate={false}>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="field">
              {t("name")} *
              <input name="name" required autoComplete="name" />
            </label>
            <label className="field">
              {t("jobTitle")} *
              <input name="jobTitle" required autoComplete="organization-title" />
            </label>
            <label className="field">
              {t("company")}
              <input name="company" autoComplete="organization" />
            </label>
            <label className="field">
              {t("email")} *
              <input name="email" type="email" required autoComplete="email" />
            </label>
          </div>

          <div className="mt-5">
            <span className="field">{t("phone")} *</span>
            <div className="grid grid-cols-[minmax(0,10.5rem)_1fr] gap-2" dir="ltr">
              <label className="field sr-only" htmlFor="dial">{t("countryCode")}</label>
              <select id="dial" name="dial" value={dial} onChange={(e) => setDial(e.target.value)} className="field-input mt-[.45rem]" aria-label={t("countryCode")}>
                {DIAL_CODES.map(([iso, name, code]) => (
                  <option key={iso} value={code}>
                    {flagOf(iso)} {name} ({code})
                  </option>
                ))}
              </select>
              <label className="field sr-only" htmlFor="phone">{t("phone")}</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                required
                autoComplete="tel-national"
                pattern="[0-9 ()+\-]{4,20}"
                placeholder={dial === "+372" ? "5666 6760" : ""}
                className="field-input mt-[.45rem]"
              />
            </div>
          </div>

          {audience === "team" ? (
            <label className="field mt-5">
              {t("topic")} *
              <select name="topic" required defaultValue="">
                <option value="" disabled>
                  {t("topicPlaceholder")}
                </option>
                {TOPICS.map((k) => (
                  <option key={k} value={k}>
                    {t(`topics.${k}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field mt-5">
            {t("subject")} *
            <input name="subject" required maxLength={120} />
          </label>
          <label className="field mt-5">
            {t("message")} *
            <textarea name="message" required rows={5} />
          </label>
          <label className="mt-5 flex items-start gap-2.5 text-xs text-text-muted">
            <input type="checkbox" name="consent" required className="mt-0.5 accent-current" />
            <span>{t("consent")}</span>
          </label>
          {state === "error" ? <p className="mt-4 text-sm text-text">{t("error", { email: to })}</p> : null}
          <button type="submit" disabled={state === "sending"} className="button-primary mt-7 w-full">
            {state === "sending" ? t("sending") : t("submit")}
          </button>
          {!formId ? <p className="mt-3 text-center text-xs text-text-faint">{t("fallbackNote")}</p> : null}
        </form>
      )}
    </div>
  );
}
