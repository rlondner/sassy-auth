// @marsidev/react-turnstile ships ESM-only output that ts-jest's default
// transform doesn't parse. Tests exercising the widget's callbacks mock the
// real module directly (see signup-form.test.tsx); this global stub only
// exists so files that transitively import a component using <Turnstile>
// (e.g. page.test.tsx importing page.tsx) don't hit the unparseable ESM file.
export function Turnstile() {
  return null
}
