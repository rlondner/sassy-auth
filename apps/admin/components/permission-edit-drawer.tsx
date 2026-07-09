'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle,
  Button, ButtonGroup, Input, Label,
} from '@sassy-auth/ui'
import { updatePermissionAction } from '@/app/(admin)/permissions/actions'
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import type { PermissionRow } from '@/lib/types'

const NAME_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]+)+$/

interface Props {
  permission: PermissionRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function PermissionEditDrawer({ permission, open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations()
  const [name, setName] = React.useState(permission.name)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const { copiedKey, copy } = useCopyFeedback()
  const copied = copiedKey !== null
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    setName(permission.name)
    setErrorKey(null)
  }, [permission])

  const dirty = name !== permission.name

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    if (!NAME_REGEX.test(name.trim())) { setErrorKey('permissions.errors.nameInvalid'); return }
    startTransition(async () => {
      const result = await updatePermissionAction(permission.publicId, { name: name.trim() })
      if ('errorKey' in result) {
        setErrorKey(result.errorKey)
        return
      }
      toast.success(t('permissions.toast.updated'))
      onSuccess?.()
      onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('permissions.drawer.editTitle')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="permName">{t('permissions.fields.name')}</Label>
              <Input
                id="permName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="font-mono"
              />
              <p className="mt-1 text-label-sm text-muted-foreground">{t('permissions.fields.nameHint')}</p>
            </div>
            <div>
              <Label>{t('permissions.fields.app')}</Label>
              <div className="mt-1 flex items-center justify-between rounded border border-border bg-card px-3 py-2">
                <span className="text-body-sm">{permission.app.name}</span>
                <code className="font-mono text-label-md text-muted-foreground">{permission.app.publicId}</code>
              </div>
              <p className="mt-1 text-label-sm text-muted-foreground">{t('permissions.fields.appImmutable')}</p>
            </div>
            <div>
              <Label htmlFor="permPublicId">{t('permissions.fields.publicId')}</Label>
              <div className="flex gap-2">
                <Input id="permPublicId" value={permission.publicId} readOnly className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('permissions.actions.copy')}
                  onClick={() =>
                    void copy(permission.publicId, 'publicId')
                  }
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {copied ? 'check' : 'content_copy'}
                  </span>
                </Button>
              </div>
              {copied && (
                <p className="mt-1 text-label-sm text-primary">{t('permissions.actions.copied')}</p>
              )}
            </div>
            {errorKey && (
              <p role="alert" className="text-body-sm text-destructive">{t(errorKey)}</p>
            )}
            <div className="flex justify-end pt-4">
              <ButtonGroup>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} loading={pending}>
                  {t('permissions.drawer.cancel')}
                </Button>
                <Button type="submit" disabled={!dirty || pending}>
                  {t('permissions.drawer.save')}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
