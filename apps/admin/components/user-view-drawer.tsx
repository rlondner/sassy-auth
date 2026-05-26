'use client'

import type { User } from '@/lib/types'

interface UserViewDrawerProps {
  user: User | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserViewDrawer({ user, open, onOpenChange }: UserViewDrawerProps) {
  if (!open || !user) return null
  return <div data-testid="user-view-drawer">{user.firstName} {user.lastName}</div>
}
