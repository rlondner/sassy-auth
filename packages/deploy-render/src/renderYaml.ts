import { parse } from 'yaml';

export interface RenderYamlEnvVar {
  key: string;
  value?: string;
  sync?: boolean;
  fromGroup?: string;
}

export interface RenderYamlService {
  name: string;
  envVars?: RenderYamlEnvVar[];
}

export interface RenderYamlDocument {
  envVarGroups?: Array<{ name: string; envVars: RenderYamlEnvVar[] }>;
  services: RenderYamlService[];
}

export function parseRenderYaml(contents: string): RenderYamlDocument {
  return parse(contents) as RenderYamlDocument;
}

function literalValues(envVars: RenderYamlEnvVar[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const envVar of envVars ?? []) {
    if (typeof envVar.value === 'string') {
      result[envVar.key] = envVar.value;
    }
  }
  return result;
}

export function staticGroupValues(doc: RenderYamlDocument, groupName: string): Record<string, string> {
  const group = doc.envVarGroups?.find((g) => g.name === groupName);
  if (!group) {
    throw new Error(`render.yaml has no envVarGroup named "${groupName}"`);
  }
  return literalValues(group.envVars);
}

export function staticServiceValues(doc: RenderYamlDocument, serviceName: string): Record<string, string> {
  const service = doc.services.find((s) => s.name === serviceName);
  if (!service) {
    throw new Error(`render.yaml has no service named "${serviceName}"`);
  }
  return literalValues(service.envVars);
}
