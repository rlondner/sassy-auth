import type { PasswordPolicy } from '@sassy-auth/types'

export type { PasswordPolicy }

// Matches the server's global default password policy. Used by signup and
// reset-password forms when a per-app/per-request policy hasn't been
// resolved yet (or its fetch failed), so the live checklist still has
// something sane to render instead of crashing.
export const FALLBACK_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

export interface User {
  id: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string | null
  username: string | null
  orgId: string
  status: 'active' | 'pending' | 'inactive' | 'unverified'
  // bug-0186: both fields are now real. The API always returns them:
  // `createdAt` is a NOT-NULL DB column; `lastLoginAt` is nullable in
  // the DB (null means "never signed in") and preserved as such over
  // the wire. Both are ISO strings.
  createdAt: string
  lastLoginAt: string | null
}

export interface Org {
  id: string
  name: string
  appId: string
  isPlatform: boolean
}

export interface Role {
  publicId: string
  name: string
  appId: string
}

export interface Permission {
  id: string
  name: string
  appId: string
  isSystem?: boolean
}

export interface MeProfile {
  userId: string
  org: { id: string; name: string; isPlatform: boolean }
  app: { id: string; name: string; isPlatform: boolean }
}

export interface CreateUserPayload {
  firstName: string
  lastName: string
  email: string
  orgId: string
  username?: string
  phoneNumber?: string
  roleIds?: string[]
  directPermissionIds?: string[]
}

export interface CreateUserResponse {
  user: User
  inviteUrl: string
}

export interface InvitationInfo {
  firstName: string
  email: string
  expired: boolean
  passwordPolicy: PasswordPolicy
}

export interface RedirectUri {
  uri: string;
  kind: 'login' | 'post_logout';
}

export interface App {
  publicId: string;
  name: string;
  url: string;
  redirectUris?: RedirectUri[];
  isPlatform: boolean;
  twoFactorTrustDays?: number | null;
  requireTwoFactor: boolean;
  // Client type is derived from whether a secret hash exists server-side —
  // the hash itself is never sent to the admin console.
  isConfidential?: boolean;
  clientSecretUpdatedAt?: string | null;
  defaultOrgId?: string | null;
  defaultRoleId?: string | null;
  passwordPolicyOverride: PasswordPolicy | null;
  effectivePasswordPolicy: PasswordPolicy;
}

export interface CreateAppPayload {
  name: string;
  url: string;
  redirectUris?: RedirectUri[];
  twoFactorTrustDays?: number | null;
  requireTwoFactor?: boolean;
}

export interface UpdateAppPayload {
  name?: string;
  url?: string;
  redirectUris?: RedirectUri[];
  twoFactorTrustDays?: number | null;
  requireTwoFactor?: boolean;
  defaultOrgId?: string | null;
  defaultRoleId?: string | null;
  passwordPolicyOverride?: PasswordPolicy | null;
}

export interface ListAppsParams {
  page?: number;
  pageSize?: number;
  q?: string;
}

export interface ListAppsResponse {
  items: App[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OrgRow {
  publicId: string;
  name: string;
  isPlatform: boolean;
  userCount: number;
  app: { publicId: string; name: string };
}

export interface CreateOrgPayload {
  name: string;
  appId: string;
}

export interface UpdateOrgPayload {
  name?: string;
}

export interface ListOrgsParams {
  page?: number;
  pageSize?: number;
  q?: string;
  appId?: string;
}

export interface ListOrgsResponse {
  items: OrgRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PermissionRow {
  publicId: string
  name: string
  app: { publicId: string; name: string }
  roleCount: number
  userCount: number
  isSystem: boolean
}

export interface PermissionDetail extends PermissionRow {
  roles: Array<{ publicId: string; name: string; appName: string }>
  users: Array<{ publicId: string; email: string; firstName: string; lastName: string }>
}

export interface CreatePermissionPayload {
  name: string
  appId: string
}

export interface UpdatePermissionPayload {
  name?: string
}

export interface ListPermissionsParams {
  q?: string
  appId?: string
  page?: number
  pageSize?: number
}

export interface ListPermissionsResponse {
  items: PermissionRow[]
  total: number
  page: number
  pageSize: number
}

export interface RoleRow {
  publicId: string
  name: string
  app: { publicId: string; name: string }
  permissionCount: number
  userCount: number
}

export interface RolePermissionRef {
  publicId: string
  name: string
}

export interface RoleDetail extends RoleRow {
  permissions: RolePermissionRef[]
}

export interface CreateRolePayload {
  name: string
  appId: string
  permissionIds?: string[]
}

export interface UpdateRolePayload {
  name?: string
  permissionIds?: string[]
}

export interface ListRolesParams {
  q?: string
  appId?: string
  page?: number
  pageSize?: number
}

export interface ListRolesResponse {
  items: RoleRow[]
  total: number
  page: number
  pageSize: number
}
