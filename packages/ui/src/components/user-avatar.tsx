import * as React from 'react'
import { cn } from '../lib/utils'

const AVATAR_COLORS = [
  'bg-[#3525cd] text-white',
  'bg-[#5c64a8] text-white',
  'bg-[#6750a4] text-white',
  'bg-[#026e5e] text-white',
  'bg-[#b44b00] text-white',
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

const sizes = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-label-sm', lg: 'h-12 w-12 text-body-md' }

export function UserAvatar({ firstName, lastName, src, size = 'md', className }: UserAvatarProps) {
  const initials = [firstName[0], lastName[0]].filter(Boolean).join('').toUpperCase()
  const colorClass = colorForName(`${firstName}${lastName}`)

  if (src) {
    return (
      <img
        src={src}
        alt={`${firstName} ${lastName}`}
        className={cn('rounded-lg object-cover', sizes[size], className)}
      />
    )
  }

  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-lg font-bold', sizes[size], colorClass, className)}
    >
      {initials}
    </span>
  )
}
