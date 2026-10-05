import { obfuscateEmail } from '../obfuscate-email'

describe('obfuscateEmail', () => {
  it('masks the local part and domain name, keeping the extension intact', () => {
    expect(obfuscateEmail('golightly@hotmail.fr')).toBe('gol******@hot****.fr')
  })

  it('keeps multi-label extensions fully visible', () => {
    expect(obfuscateEmail('alice@example.co.uk')).toBe('ali**@exa****.co.uk')
  })

  it('leaves short local parts and domain names unmasked', () => {
    expect(obfuscateEmail('al@ex.com')).toBe('al@ex.com')
  })

  it('returns the input unchanged when it has no @', () => {
    expect(obfuscateEmail('not-an-email')).toBe('not-an-email')
  })

  it('returns the input unchanged when the domain has no dot', () => {
    expect(obfuscateEmail('alice@localhost')).toBe('alice@localhost')
  })
})
