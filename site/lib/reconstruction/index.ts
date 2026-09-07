/** Wiring: which provider adapters exist and how a request handler obtains a service. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderId, ReconstructionProvider } from "./contract";
import { kiriProvider } from "./kiri";
import { marbleProvider } from "./marble";
import { ReconstructionService, type Providers } from "./service";
import { SupabaseJobStore } from "./store";

export const PROVIDERS: Record<ProviderId, ReconstructionProvider> = { kiri: kiriProvider, marble: marbleProvider };

export function enabledProviders(): Providers {
  const out: Providers = {};
  for (const provider of Object.values(PROVIDERS)) if (provider.enabled()) out[provider.id] = provider;
  return out;
}

export function reconstructionService(admin: SupabaseClient): ReconstructionService {
  return new ReconstructionService(new SupabaseJobStore(admin), enabledProviders());
}
