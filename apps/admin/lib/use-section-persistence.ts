'use client'

import * as React from 'react'

export type SectionId = 'general' | 'branding' | 'security' | 'access' | 'credentials' | 'legal'
export type DrawerType = 'create' | 'edit' | 'view'

type SectionMap = Partial<Record<SectionId, boolean>>

function storageKey(drawerType: DrawerType): string {
  return `sa-app-drawer-sections:${drawerType}`
}

function readStored(drawerType: DrawerType): SectionMap {
  try {
    const raw = window.localStorage.getItem(storageKey(drawerType))
    return raw ? (JSON.parse(raw) as SectionMap) : {}
  } catch {
    return {}
  }
}

function writeStored(drawerType: DrawerType, map: SectionMap): void {
  try {
    window.localStorage.setItem(storageKey(drawerType), JSON.stringify(map))
  } catch {
    // Private browsing / storage-disabled tabs must not break the toggle —
    // the section still updates in memory for the rest of this session.
  }
}

/**
 * Owns the open/closed state for a drawer's CollapsibleSections, persisted to
 * localStorage per drawer type (shared across every app, not keyed by app id
 * — see the design spec). `defaults` supplies per-section overrides; any
 * section with neither a stored value nor a default entry opens by default.
 */
export function useSectionPersistence(drawerType: DrawerType, defaults: SectionMap) {
  const [stored, setStored] = React.useState<SectionMap>(() =>
    typeof window === 'undefined' ? {} : readStored(drawerType),
  )

  const isOpen = React.useCallback(
    (id: SectionId) => stored[id] ?? defaults[id] ?? true,
    [stored, defaults],
  )

  const setOpen = React.useCallback(
    (id: SectionId, open: boolean) => {
      setStored((prev) => {
        const next = { ...prev, [id]: open }
        writeStored(drawerType, next)
        return next
      })
    },
    [drawerType],
  )

  return { isOpen, setOpen }
}
