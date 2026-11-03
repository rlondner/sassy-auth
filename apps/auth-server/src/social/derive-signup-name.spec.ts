import { deriveSignupName } from './derive-signup-name';

describe('deriveSignupName', () => {
  it('uses givenName/familyName when both are present', () => {
    expect(
      deriveSignupName({ name: 'ignored', givenName: 'Ada', familyName: 'Lovelace' }),
    ).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
  });

  it('falls back to splitting name on the first space when givenName is missing', () => {
    expect(
      deriveSignupName({ name: 'Grace Hopper', givenName: null, familyName: 'Hopper' }),
    ).toEqual({ firstName: 'Grace', lastName: 'Hopper' });
  });

  it('falls back to splitting name on the first space when familyName is missing', () => {
    expect(
      deriveSignupName({ name: 'Grace Hopper', givenName: 'Grace', familyName: null }),
    ).toEqual({ firstName: 'Grace', lastName: 'Hopper' });
  });

  it('splits a multi-word name on only the first space — everything after goes to lastName', () => {
    expect(
      deriveSignupName({ name: 'Mary Jane Watson', givenName: null, familyName: null }),
    ).toEqual({ firstName: 'Mary', lastName: 'Jane Watson' });
  });

  it('yields an empty lastName for a single-word name', () => {
    expect(deriveSignupName({ name: 'Prince', givenName: null, familyName: null })).toEqual({
      firstName: 'Prince',
      lastName: '',
    });
  });

  it('yields an empty firstName and lastName for an empty name', () => {
    expect(deriveSignupName({ name: '', givenName: null, familyName: null })).toEqual({
      firstName: '',
      lastName: '',
    });
  });

  it('trims surrounding whitespace before splitting', () => {
    expect(deriveSignupName({ name: '  Ada Lovelace  ', givenName: null, familyName: null })).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });
});
