'use client'

import type { Org } from '@/lib/types'

interface UserCreateDrawerProps {
  orgs: Org[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserCreateDrawer({ orgs, open, onOpenChange }: UserCreateDrawerProps) {
  if (!open) return null
  return <div data-testid="user-create-drawer">Create User</div>
}
