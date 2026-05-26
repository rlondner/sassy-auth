export interface User {
  id: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string | null
  username: string | null
  orgId: string
  status: 'active' | 'pending' | 'inactive'
  lastLoginAt?: string | null
  createdAt?: string
}

export interface Org {
  id: string
  name: string
  appId: string
  isPlatform: boolean
}

export interface Role {
  id: string
  name: string
  appId: string
}

export interface Permission {
  id: string
  name: string
  appId: string
}

export interface CreateUserPayload {
  firstName: string
  lastName: string
  email: string
  orgId: string
  username?: string
  phoneNumber?: string
}

export interface CreateUserResponse {
  user: User
  inviteUrl: string
}

export interface InvitationInfo {
  firstName: string
  email: string
  expired: boolean
}
