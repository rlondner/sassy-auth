import * as React from 'react'
import { cn } from '../lib/utils'

const AVATAR_COLORS = [
  'bg-orange-100  text-orange-700  ring-1 ring-orange-200  dark:bg-orange-900/40  dark:text-orange-300  dark:ring-orange-800',
  'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:ring-emerald-800',
  'bg-purple-100  text-purple-700  ring-1 ring-purple-200  dark:bg-purple-900/40  dark:text-purple-300  dark:ring-purple-800',
  'bg-pink-100    text-pink-700    ring-1 ring-pink-200    dark:bg-pink-900/40    dark:text-pink-300    dark:ring-pink-800',
  'bg-indigo-100  text-indigo-700  ring-1 ring-indigo-200  dark:bg-indigo-900/40  dark:text-indigo-300  dark:ring-indigo-800',
  'bg-teal-100    text-teal-700    ring-1 ring-teal-200    dark:bg-teal-900/40    dark:text-teal-300    dark:ring-teal-800',
  'bg-rose-100    text-rose-700    ring-1 ring-rose-200    dark:bg-rose-900/40    dark:text-rose-300    dark:ring-rose-800',
  'bg-blue-100    text-blue-700    ring-1 ring-blue-200    dark:bg-blue-900/40    dark:text-blue-300    dark:ring-blue-800',
]

function colorForName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

interface UserAvatarProps {
  firstName: string
  lastName: string
  src?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' }

export function UserAvatar({ firstName, lastName, src, size = 'md', className }: UserAvatarProps) {
  const initials = [firstName[0], lastName[0]].filter(Boolean).join('').toUpperCase()
  const colorClass = colorForName(`${firstName}${lastName}`)

  if (src) {
    return (
      <img
        src={src}
        alt={`${firstName} ${lastName}`}
        className={cn('rounded-full object-cover', sizes[size], className)}
      />
    )
  }

  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-full font-medium', sizes[size], colorClass, className)}
    >
      {initials}
    </span>
  )
}
