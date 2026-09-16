// Loading the spec via <redoc spec-url="..."> instead of this fetch +
// Redoc.init(specObject, ...) call silently drops info["x-logo"] in this
// ReDoc version (its URL-loading path parses the spec differently from its
// object-loading path) — verified empirically, not documented. Kept as its
// own file (rather than an inline <script>) so it stays same-origin under
// the page's strict script-src 'self' CSP.
export function renderRedocInitScript(): string {
  return `fetch('/api/docs-json')
  .then((res) => res.json())
  .then((spec) => Redoc.init(spec, {}, document.getElementById('redoc-container')));
`;
}
