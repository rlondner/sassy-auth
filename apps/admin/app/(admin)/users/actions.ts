'use server'

import { revalidatePath } from 'next/cache'
import { createUser, assignRole } from '@/lib/api'
import type { CreateUserPayload } from '@/lib/types'

interface CreateUserInput extends CreateUserPayload {
  roleId?: string
}

export async function createUserAction(
  input: CreateUserInput,
): Promise<{ inviteUrl: string } | { error: string }> {
  try {
    const { roleId, ...payload } = input
    const { user, inviteUrl } = await createUser(payload)
    if (roleId) await assignRole(user.id, roleId)
    revalidatePath('/users')
    return { inviteUrl }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('409') || message.includes('already')) return { error: 'A user with this email already exists.' }
    return { error: message }
  }
}
