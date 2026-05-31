'use client'

import * as React from 'react'
import Link from 'next/link'
import { ShieldCheck, Boxes, Building2, Users, ShieldEllipsis, KeyRound } from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider,
} from '@sassy-auth/ui'
import { UserFooter } from './user-footer'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavGroup {
  label: string
  items: NavItem[]
}

interface SidebarShellProps {
  groups: NavGroup[]
  currentPath: string
  user: { firstName: string; lastName: string; email: string }
  currentLocale: string
  availableLocales: string[]
  signOutLabel: string
  lightModeLabel: string
  darkModeLabel: string
  children: React.ReactNode
}

export function SidebarShell({
  groups, currentPath, user, currentLocale, availableLocales,
  signOutLabel, lightModeLabel, darkModeLabel, children,
}: SidebarShellProps) {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r-0">
        <SidebarHeader className="border-b border-sidebar-border bg-sidebar px-5 py-4">
          <Link href="/" className="flex items-center gap-2 text-white">
            <ShieldCheck className="h-6 w-6 text-brand-500" />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-semibold tracking-wide">SassyAuth</span>
              <span className="text-[10px] font-normal text-sidebar-foreground">Admin Console</span>
            </div>
          </Link>
        </SidebarHeader>

        <SidebarContent className="bg-sidebar px-3 py-4">
          {groups.map((g) => (
            <SidebarGroup key={g.label}>
              <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {g.label}
              </SidebarGroupLabel>
              <SidebarMenu>
                {g.items.map((item) => {
                  const isActive = currentPath.startsWith(item.href)
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className={
                          isActive
                            ? 'bg-brand-600 text-white shadow-sm ring-1 ring-brand-700/50 hover:bg-brand-600 hover:text-white'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-white'
                        }
                      >
                        <Link href={item.href}>
                          <Icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className="p-0">
          <UserFooter
            user={user}
            currentLocale={currentLocale}
            availableLocales={availableLocales}
            signOutLabel={signOutLabel}
            lightModeLabel={lightModeLabel}
            darkModeLabel={darkModeLabel}
          />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-background">{children}</SidebarInset>
    </SidebarProvider>
  )
}

export const NavIcons = { Boxes, Building2, Users, ShieldEllipsis, KeyRound }
