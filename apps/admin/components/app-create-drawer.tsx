"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Button,
  ButtonGroup,
  Input,
  Label,
} from "@sassy-auth/ui";
import { createAppAction } from "@/app/(admin)/apps/actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function AppCreateDrawer({ open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations();
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [callbackUrl, setCallbackUrl] = React.useState("");
  const [twoFactorTrustDays, setTwoFactorTrustDays] = React.useState<
    number | null
  >(null);
  const [requireTwoFactor, setRequireTwoFactor] =
    React.useState<boolean>(false);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) {
      setName("");
      setUrl("");
      setCallbackUrl("");
      setTwoFactorTrustDays(null);
      setRequireTwoFactor(false);
      setErrorKey(null);
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErrorKey("apps.errors.nameRequired");
      return;
    }
    setErrorKey(null);
    startTransition(async () => {
      const result = await createAppAction({
        name: name.trim(),
        url: url.trim(),
        callbackUrl: callbackUrl.trim() || null,
        twoFactorTrustDays,
        requireTwoFactor,
      });
      if ("errorKey" in result) {
        setErrorKey(result.errorKey);
        return;
      }
      toast.success(t("apps.toast.created"));
      onSuccess?.();
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>{t("apps.drawer.createTitle")}</SheetTitle>
            <SheetDescription>
              {t("apps.drawer.createSubtitle")}
            </SheetDescription>
          </div>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="appName">{t("apps.fields.name")}</Label>
              <Input
                id="appName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="appUrl">{t("apps.fields.url")}</Label>
              <Input
                id="appUrl"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                placeholder="https://app.example.com"
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t("apps.fields.urlHint")}
              </p>
            </div>
            <div>
              <Label htmlFor="appCallbackUrl">
                {t("apps.fields.callbackUrl")}
              </Label>
              <Input
                id="appCallbackUrl"
                type="url"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="https://app.example.com/auth/callback"
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t("apps.fields.callbackUrlHint")}
              </p>
            </div>
            <div>
              <Label htmlFor="appTrustDays">
                {t("apps.fields.twoFactorTrustDays")}
              </Label>
              <Input
                id="appTrustDays"
                type="number"
                min={1}
                max={3650}
                value={twoFactorTrustDays ?? ""}
                onChange={(e) =>
                  setTwoFactorTrustDays(
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                placeholder={t("apps.fields.twoFactorTrustDaysPlaceholder")}
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t("apps.fields.twoFactorTrustDaysHint")}
              </p>
            </div>
            <div>
              <label className="flex items-center gap-2 text-label-md cursor-pointer">
                <input
                  type="checkbox"
                  id="requireTwoFactor"
                  checked={requireTwoFactor}
                  onChange={(e) => setRequireTwoFactor(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                {t("apps.fields.requireTwoFactor")}
              </label>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t("apps.fields.requireTwoFactorHint")}
              </p>
            </div>
            <div className="rounded border border-border bg-muted p-3 text-body-sm text-muted-foreground">
              <span className="material-symbols-outlined align-middle text-[16px] text-primary">
                info
              </span>{" "}
              {t("apps.drawer.identifiersAutoGenerated")}
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
                  loading={pending}
                >
                  {t("apps.drawer.cancel")}
                </Button>
                <Button type="submit" loading={pending}>
                  {t("apps.drawer.createTitle")}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
