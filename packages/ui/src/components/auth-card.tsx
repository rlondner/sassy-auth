import * as React from 'react'
import { cn } from '../lib/utils'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'

export interface AuthCardProps {
  title?: string
  subtitle?: string
  icon?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

export function AuthCard({ title, subtitle, icon, footer, className, children }: AuthCardProps) {
  const hasHeader = Boolean(title || subtitle || icon)
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className={cn('w-full max-w-sm', className)}>
        {hasHeader && (
          <CardHeader className="text-center">
            {icon && <div className="mb-4 flex justify-center">{icon}</div>}
            {title && <CardTitle className="text-headline-sm">{title}</CardTitle>}
            {subtitle && <CardDescription className="mt-1 text-body-sm">{subtitle}</CardDescription>}
          </CardHeader>
        )}
        {children && <CardContent className={hasHeader ? undefined : 'pt-6'}>{children}</CardContent>}
        {footer && <CardFooter className="flex flex-col gap-2 pt-0">{footer}</CardFooter>}
      </Card>
    </div>
  )
}
