import 'server-only'
import { cookies } from 'next/headers'
import * as Sentry from '@sentry/nextjs'
import type { User, Org, Role, Permission, CreateUserPayload, CreateUserResponse, App, CreateAppPayload, UpdateAppPayload, ListAppsParams, ListAppsResponse } from './types'

const BASE = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieStore.toString(),
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  return res
}

export async function getUsers(filters?: { orgId?: string }): Promise<User[]> {
  const params = filters?.orgId ? `?orgId=${filters.orgId}` : ''
  const res = await apiFetch(`/api/users${params}`)
  return res.json()
}

export async function getUser(id: string): Promise<User> {
  const res = await apiFetch(`/api/users/${id}`)
  return res.json()
}

export async function createUser(payload: CreateUserPayload): Promise<CreateUserResponse> {
  const res = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(payload) })
  const result: CreateUserResponse = await res.json()
  Sentry.addBreadcrumb({ category: 'admin.action', message: `User created: ${result.user.email}`, level: 'info' })
  return result
}

export async function updateUser(id: string, patch: Partial<User>): Promise<User> {
  const res = await apiFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
  const result: User = await res.json()
  Sentry.addBreadcrumb({ category: 'admin.action', message: `User updated: ${id}`, level: 'info' })
  return result
}

export async function deleteUser(id: string): Promise<void> {
  await apiFetch(`/api/users/${id}`, { method: 'DELETE' })
  Sentry.addBreadcrumb({ category: 'admin.action', message: `User deleted: ${id}`, level: 'info' })
}

export async function getOrgs(): Promise<Org[]> {
  const res = await apiFetch('/api/orgs')
  return res.json()
}

export async function getRoles(appId?: string): Promise<Role[]> {
  const params = appId ? `?appId=${appId}` : ''
  const res = await apiFetch(`/api/roles${params}`)
  return res.json()
}

export async function getUserRoles(userId: string): Promise<Role[]> {
  const res = await apiFetch(`/api/users/${userId}/roles`)
  return res.json()
}

export async function getEffectivePermissions(userId: string): Promise<Permission[]> {
  const res = await apiFetch(`/api/users/${userId}/effective-permissions`)
  return res.json()
}

export async function assignRole(userId: string, roleId: string): Promise<void> {
  await apiFetch(`/api/users/${userId}/roles`, { method: 'POST', body: JSON.stringify({ roleId }) })
  Sentry.addBreadcrumb({ category: 'admin.action', message: `Role ${roleId} assigned to user ${userId}`, level: 'info' })
}

export async function removeRole(userId: string, roleId: string): Promise<void> {
  await apiFetch(`/api/users/${userId}/roles/${roleId}`, { method: 'DELETE' })
  Sentry.addBreadcrumb({ category: 'admin.action', message: `Role ${roleId} removed from user ${userId}`, level: 'info' })
}

export async function resendInvitation(userId: string): Promise<{ inviteUrl: string }> {
  const res = await apiFetch(`/api/users/${userId}/resend-invitation`, { method: 'POST' })
  const result = await res.json()
  Sentry.addBreadcrumb({ category: 'admin.action', message: `Invitation resent for user ${userId}`, level: 'info' })
  return result
}

// Public endpoints — no session cookie needed
export async function validateInvitation(token: string): Promise<InvitationInfo> {
  const res = await fetch(`${BASE}/api/invitations/${token}`)
  if (!res.ok) throw new Error(`API error ${res.status}: /api/invitations/${token}`)
  return res.json()
}

export async function acceptInvitation(token: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/api/invitations/${token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}: accept invitation`)
}


export async function getApps(params: ListAppsParams = {}): Promise<ListAppsResponse> {
  const sp = new URLSearchParams();
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  if (params.q) sp.set('q', params.q);
  const qs = sp.toString();
  const res = await apiFetch(`/api/apps${qs ? `?${qs}` : ''}`);
  return res.json();
}

export async function createApp(payload: CreateAppPayload): Promise<App> {
  const res = await apiFetch('/api/apps', { method: 'POST', body: JSON.stringify(payload) });
  const app: App = await res.json();
  Sentry.addBreadcrumb({ category: 'admin.action', message: `App created: ${app.publicId}`, level: 'info' });
  return app;
}

export async function updateApp(publicId: string, patch: UpdateAppPayload): Promise<App> {
  const res = await apiFetch(`/api/apps/${publicId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  const app: App = await res.json();
  Sentry.addBreadcrumb({ category: 'admin.action', message: `App updated: ${publicId}`, level: 'info' });
  return app;
}

export async function deleteApp(publicId: string): Promise<void> {
  await apiFetch(`/api/apps/${publicId}`, { method: 'DELETE' });
  Sentry.addBreadcrumb({ category: 'admin.action', message: `App deleted: ${publicId}`, level: 'info' });
}

export async function getMyPermissions(): Promise<string[]> {
  const res = await apiFetch('/api/me/permissions');
  const body: { permissions: string[] } = await res.json();
  return body.permissions;
}
