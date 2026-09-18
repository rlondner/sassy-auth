import { parseRenderYaml, staticGroupValues, staticServiceValues } from './renderYaml';

const FIXTURE = `
envVarGroups:
  - name: sassy-auth-production
    envVars:
      - key: DATABASE_URL
        sync: false
      - key: BETTER_AUTH_URL
        value: https://auth-api.milissai.com
      - key: NODE_ENV
        value: production

services:
  - type: web
    name: sassy-auth-server
    envVars:
      - fromGroup: sassy-auth-production
      - key: NODE_VERSION
        value: "24"
      - key: RESEND_API_KEY
        sync: false
  - type: web
    name: sassy-auth-admin
    envVars:
      - fromGroup: sassy-auth-production
      - key: PUBLIC_AUTH_SERVER_URL
        value: https://auth-api.milissai.com
`;

describe('parseRenderYaml + staticGroupValues', () => {
  it('extracts only literal-value entries from the named group', () => {
    const doc = parseRenderYaml(FIXTURE);
    expect(staticGroupValues(doc, 'sassy-auth-production')).toEqual({
      BETTER_AUTH_URL: 'https://auth-api.milissai.com',
      NODE_ENV: 'production',
    });
  });

  it('throws for an unknown group', () => {
    const doc = parseRenderYaml(FIXTURE);
    expect(() => staticGroupValues(doc, 'missing-group')).toThrow(/no envVarGroup named "missing-group"/);
  });
});

describe('staticServiceValues', () => {
  it('extracts only literal-value entries for the named service', () => {
    const doc = parseRenderYaml(FIXTURE);
    expect(staticServiceValues(doc, 'sassy-auth-server')).toEqual({ NODE_VERSION: '24' });
    expect(staticServiceValues(doc, 'sassy-auth-admin')).toEqual({
      PUBLIC_AUTH_SERVER_URL: 'https://auth-api.milissai.com',
    });
  });

  it('throws for an unknown service', () => {
    const doc = parseRenderYaml(FIXTURE);
    expect(() => staticServiceValues(doc, 'missing-service')).toThrow(/no service named "missing-service"/);
  });
});
