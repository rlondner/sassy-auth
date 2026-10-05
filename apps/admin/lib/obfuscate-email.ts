/**
 * Masks an email for display, e.g. "golightly@hotmail.fr" -> "gol******@hot****.fr".
 * Keeps the first 3 characters of the local part and of the domain name
 * visible, masks the rest with asterisks, and leaves the domain extension
 * (everything from the first dot onward, e.g. ".fr" or ".co.uk") untouched.
 */
export function obfuscateEmail(email: string): string {
  const atIndex = email.indexOf('@')
  if (atIndex === -1) return email

  const local = email.slice(0, atIndex)
  const domain = email.slice(atIndex + 1)
  const dotIndex = domain.indexOf('.')
  if (dotIndex === -1) return email

  const domainName = domain.slice(0, dotIndex)
  const extension = domain.slice(dotIndex)

  return `${maskTail(local)}@${maskTail(domainName)}${extension}`
}

function maskTail(value: string): string {
  return value.length <= 3 ? value : value.slice(0, 3) + '*'.repeat(value.length - 3)
}
