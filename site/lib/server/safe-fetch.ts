/**
 * Outbound fetch guard for provider-supplied download URLs.
 *
 * Providers hand SODAR temporary URLs (KIRI model zips, Marble asset URLs).
 * Those URLs are data from a third party, so before the server fetches one it
 * must be https, point at a public hostname (no loopback, link-local, private
 * ranges, or bare IP literals), and the response is capped in size and time.
 */
import { ProviderError, type ProviderId } from "@/lib/reconstruction/contract";

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal|instance-data)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function assertPublicHttpsUrl(raw: string, provider: ProviderId): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError(provider, "fatal", "invalid_download_url", "The provider returned an unusable download address.");
  }
  if (url.protocol !== "https:") throw new ProviderError(provider, "fatal", "invalid_download_url", "Provider downloads must use HTTPS.");
  if (url.username || url.password) throw new ProviderError(provider, "fatal", "invalid_download_url", "Provider downloads must not embed credentials.");
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || IPV4.test(host) || host.startsWith("[") || host.includes(":")) {
    throw new ProviderError(provider, "fatal", "invalid_download_url", "Provider downloads must target a public hostname.");
  }
  if (IPV4.test(host)) throw new ProviderError(provider, "fatal", "invalid_download_url", "Provider downloads must target a hostname, not an IP address.");
  return url;
}

export type FetchBytesOptions = { maxBytes: number; timeoutMs?: number; headers?: Record<string, string>; provider: ProviderId; fetchImpl?: typeof fetch };

/** Downloads a provider asset with a hard byte cap. Redirects are followed only to https public hosts. */
export async function fetchBytes(raw: string, options: FetchBytesOptions): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const url = assertPublicHttpsUrl(raw, options.provider);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, { headers: options.headers, redirect: "manual", signal: AbortSignal.timeout(options.timeoutMs ?? 120_000) });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new ProviderError(options.provider, "retryable", "download_redirect", "The provider download redirected without a destination.");
    return fetchBytes(new URL(location, url).toString(), { ...options, headers: undefined });
  }
  if (!response.ok) {
    const retry = response.status === 404 || response.status === 410 ? "fatal" : response.status >= 500 ? "retryable" : "fatal";
    throw new ProviderError(options.provider, retry, "download_failed", `The provider download failed (${response.status}).`, undefined, response.status);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > options.maxBytes) throw new ProviderError(options.provider, "fatal", "download_too_large", "The provider output is larger than SODAR accepts.");
  if (!response.body) return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > options.maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderError(options.provider, "fatal", "download_too_large", "The provider output is larger than SODAR accepts.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, contentType: response.headers.get("content-type") };
}
