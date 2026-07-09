'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle,
  Button, ButtonGroup, Input, Label,
} from '@sassy-auth/ui'
import { createPermissionAction } from '@/app/(admin)/permissions/actions'
import type { App } from '@/lib/types'

const NAME_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$/

interface Props {
  apps: App[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function PermissionCreateDrawer({ apps, open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations()
  const [name, setName] = React.useState('')
  const [appId, setAppId] = React.useState('')
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) {
      setName('')
      setAppId('')
      setErrorKey(null)
    }
  }, [open])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!appId) { setErrorKey('permissions.errors.appRequired'); return }
    if (!name.trim()) { setErrorKey('permissions.errors.nameRequired'); return }
    if (!NAME_REGEX.test(name.trim())) { setErrorKey('permissions.errors.nameInvalid'); return }
    setErrorKey(null)
    startTransition(async () => {
      const result = await createPermissionAction({ name: name.trim(), appId })
      if ('errorKey' in result) {
        setErrorKey(result.errorKey)
        return
      }
      toast.success(t('permissions.toast.created'))
      onSuccess?.()
      onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>{t('permissions.drawer.createTitle')}</SheetTitle>
            <SheetDescription>{t('permissions.drawer.createSubtitle')}</SheetDescription>
          </div>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="permApp">{t('permissions.fields.app')}</Label>
              <select
                id="permApp"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                required
                className="mt-1 block h-9 w-full rounded border border-border bg-card px-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>—</option>
                {apps.map((a) => (
                  <option key={a.publicId} value={a.publicId}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="permName">{t('permissions.fields.name')}</Label>
              <Input
                id="permName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="apps.read"
                className="font-mono"
              />
              <p className="mt-1 text-label-sm text-muted-foreground">{t('permissions.fields.nameHint')}</p>
            </div>
            {errorKey && (
              <p role="alert" className="text-body-sm text-destructive">
                {t(errorKey)}
              </p>
            )}
            <div className="flex justify-end pt-4">
              <ButtonGroup>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={pending}
                >
                  {t('permissions.drawer.cancel')}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? t('permissions.drawer.saving') : t('permissions.drawer.createTitle')}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
