import { safeParseAmr } from './amr';

describe('safeParseAmr', () => {
  it('parses a valid JSON array of strings', () => {
    expect(safeParseAmr(JSON.stringify(['pwd', 'otp', 'mfa']))).toEqual(['pwd', 'otp', 'mfa']);
  });

  it('falls back to pwd on invalid JSON', () => {
    expect(safeParseAmr('{not valid json')).toEqual(['pwd']);
  });

  it('filters out non-string elements from an otherwise valid array', () => {
    expect(safeParseAmr(JSON.stringify(['pwd', 42, null, 'mfa']))).toEqual(['pwd', 'mfa']);
  });

  it('falls back to pwd when the parsed value is not an array', () => {
    expect(safeParseAmr(JSON.stringify(42))).toEqual(['pwd']);
    expect(safeParseAmr(JSON.stringify({ amr: 'pwd' }))).toEqual(['pwd']);
  });
});
