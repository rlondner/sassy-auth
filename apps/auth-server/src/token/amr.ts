// The `amr` column is a Prisma `String` holding a JSON-stringified string[],
// not a statically guaranteed valid JSON array of strings — parse defensively
// and fall back to the password auth method reference on any surprise.
export function safeParseAmr(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : ['pwd'];
  } catch {
    return ['pwd'];
  }
}
