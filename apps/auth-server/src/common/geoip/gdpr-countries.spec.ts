import { isGdprCountry } from './gdpr-countries';

describe('isGdprCountry', () => {
  it('returns true for an EU member state', () => {
    expect(isGdprCountry('DE')).toBe(true);
    expect(isGdprCountry('FR')).toBe(true);
  });

  it('returns true for EEA-but-not-EU countries', () => {
    expect(isGdprCountry('NO')).toBe(true);
    expect(isGdprCountry('IS')).toBe(true);
    expect(isGdprCountry('LI')).toBe(true);
  });

  it('returns true for the UK and Switzerland', () => {
    expect(isGdprCountry('GB')).toBe(true);
    expect(isGdprCountry('CH')).toBe(true);
  });

  it('returns false for a non-applicable country', () => {
    expect(isGdprCountry('US')).toBe(false);
    expect(isGdprCountry('CA')).toBe(false);
    expect(isGdprCountry('JP')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isGdprCountry('de')).toBe(true);
  });
});
