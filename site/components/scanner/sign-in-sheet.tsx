"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Minimal sign-in for the scanner: e-mail one-time code (no redirect, so it
 * works mid-scan on a phone). Uses the public Supabase client only; nothing
 * here touches provider keys. Renders nothing when Supabase is not configured.
 */
export function SignInSheet({ open, onClose, onSignedIn }: { open: boolean; onClose: () => void; onSignedIn: (email: string) => void }) {
  const t = useTranslations("Scanner.signIn");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = getSupabaseEnv().configured;

  useEffect(() => {
    if (!open) {
      setStage("email");
      setCode("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { browserSupabase } = await import("@/lib/supabase/client");
      const { error: sendError } = await browserSupabase().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
      if (sendError) throw sendError;
      setStage("code");
    } catch {
      setError(t("sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { browserSupabase } = await import("@/lib/supabase/client");
      const { data, error: verifyError } = await browserSupabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
      if (verifyError || !data.session) throw verifyError ?? new Error("no session");
      onSignedIn(email.trim());
    } catch {
      setError(t("codeInvalid"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="signin-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <form onSubmit={stage === "email" ? sendCode : verify} className="w-full max-w-md rounded-2xl border border-white/15 bg-bg-raised p-5 text-text shadow-2xl">
        <h2 id="signin-title" className="display text-2xl">{t("title")}</h2>
        <p className="mt-2 text-sm text-text-muted">{configured ? t("body") : t("unavailable")}</p>
        {configured ? (
          stage === "email" ? (
            <label className="field mt-5 block">
              {t("emailLabel")}
              <input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field-input mt-1 w-full" placeholder="name@company.com" />
            </label>
          ) : (
            <label className="field mt-5 block">
              {t("codeLabel", { email })}
              <input type="text" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" value={code} onChange={(e) => setCode(e.target.value)} className="field-input mt-1 w-full tracking-[.3em]" placeholder="000000" />
            </label>
          )
        ) : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-200">{error}</p> : null}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="button-secondary flex-1 justify-center">{t("later")}</button>
          {configured ? <button type="submit" disabled={busy} className="button-primary flex-1 justify-center">{busy ? t("working") : stage === "email" ? t("sendCode") : t("verify")}</button> : null}
        </div>
        {stage === "code" ? <button type="button" onClick={() => setStage("email")} className="mt-3 w-full text-center font-mono text-[11px] text-text-muted underline">{t("changeEmail")}</button> : null}
      </form>
    </div>
  );
}
