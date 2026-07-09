import * as React from 'react'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
  SidebarTrigger,
} from '@sassy-auth/ui'

interface Crumb { href?: string; label: string }

interface PageHeaderProps {
  crumbs: Crumb[]
  actions?: React.ReactNode
}

export function PageHeader({ crumbs, actions }: PageHeaderProps) {
  return (
    <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border bg-card px-8">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="-ml-2" />
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1
              return (
                <React.Fragment key={i}>
                  <BreadcrumbItem>
                    {isLast || !c.href
                      ? <BreadcrumbPage>{c.label}</BreadcrumbPage>
                      : <BreadcrumbLink href={c.href}>{c.label}</BreadcrumbLink>}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </React.Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  )
}
