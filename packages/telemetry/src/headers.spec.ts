import { parseOtlpHeaders } from './headers';

describe('parseOtlpHeaders', () => {
  it('returns an empty object for undefined input', () => {
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });

  it('returns an empty object for an empty string', () => {
    expect(parseOtlpHeaders('')).toEqual({});
  });

  it('parses a single key=value pair', () => {
    expect(parseOtlpHeaders('dd-api-key=abc123')).toEqual({ 'dd-api-key': 'abc123' });
  });

  it('parses multiple comma-separated pairs', () => {
    expect(parseOtlpHeaders('k1=v1,k2=v2')).toEqual({ k1: 'v1', k2: 'v2' });
  });

  it('trims whitespace around keys and values', () => {
    expect(parseOtlpHeaders(' k1 = v1 , k2 = v2 ')).toEqual({ k1: 'v1', k2: 'v2' });
  });

  it('percent-decodes values', () => {
    expect(parseOtlpHeaders('k1=hello%20world')).toEqual({ k1: 'hello world' });
  });

  it('skips malformed pairs with no "="', () => {
    expect(parseOtlpHeaders('k1=v1,garbage,k2=v2')).toEqual({ k1: 'v1', k2: 'v2' });
  });
});
