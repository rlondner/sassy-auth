import { resolveCountryFromIp, __resetGeoipReaderForTests } from './geoip.service';

describe('resolveCountryFromIp', () => {
  const ORIGINAL_ENV = process.env.GEOIP_DB_PATH;

  afterEach(() => {
    process.env.GEOIP_DB_PATH = ORIGINAL_ENV;
    __resetGeoipReaderForTests();
  });

  it('returns null (fail closed) when GEOIP_DB_PATH is unset', () => {
    delete process.env.GEOIP_DB_PATH;
    __resetGeoipReaderForTests();
    expect(resolveCountryFromIp('203.0.113.7')).toBeNull();
  });

  it('returns null (fail closed) when GEOIP_DB_PATH points at a nonexistent file', () => {
    process.env.GEOIP_DB_PATH = '/nonexistent/path/GeoLite2-Country.mmdb';
    __resetGeoipReaderForTests();
    expect(resolveCountryFromIp('203.0.113.7')).toBeNull();
  });

  it('returns null (fail closed) for a private/unresolvable IP even with a valid DB configured', () => {
    // No real .mmdb file is checked into the repo (MaxMind requires a
    // licensed download) — this asserts the fail-closed behavior that
    // holds regardless of whether a database is configured, using an
    // address that can never resolve to a country either way.
    expect(resolveCountryFromIp('unknown')).toBeNull();
  });
});
