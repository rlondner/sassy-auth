import { existsSync, readFileSync } from 'fs';
import { Reader, type CountryResponse } from 'maxmind';

/**
 * Local MaxMind GeoLite2-Country lookup, consistent with this project's
 * self-hosted stance (no per-request call to an external geo-IP API — see
 * docs/superpowers/specs/2026-09-22-signup-legal-consent-design.md).
 *
 * No database ships with the repo (MaxMind requires a free account to
 * download GeoLite2) — GEOIP_DB_PATH is an optional, deploy-time opt-in
 * (see DEPLOYMENT.md). Every caller of resolveCountryFromIp MUST treat a
 * null return as "assume applicable" (fail closed) for whatever policy
 * consumes it — this module only resolves IP → country, it does not decide
 * applicability itself.
 */
let cachedReader: Reader<CountryResponse> | null | undefined;

function getReader(): Reader<CountryResponse> | null {
  if (cachedReader !== undefined) return cachedReader;
  const dbPath = process.env.GEOIP_DB_PATH;
  if (!dbPath || !existsSync(dbPath)) {
    cachedReader = null;
    return null;
  }
  try {
    cachedReader = new Reader<CountryResponse>(readFileSync(dbPath));
  } catch {
    cachedReader = null;
  }
  return cachedReader;
}

/** Resolve an IP to an ISO 3166-1 alpha-2 country code, or null if it can't
 * be resolved (no database configured, lookup miss, or invalid/private IP). */
export function resolveCountryFromIp(ip: string): string | null {
  const reader = getReader();
  if (!reader) return null;
  try {
    const result = reader.get(ip);
    return result?.country?.iso_code ?? null;
  } catch {
    return null;
  }
}

/** Test-only: force the next resolveCountryFromIp call to re-read
 * GEOIP_DB_PATH and reconstruct the Reader, instead of reusing the cache. */
export function __resetGeoipReaderForTests(): void {
  cachedReader = undefined;
}
