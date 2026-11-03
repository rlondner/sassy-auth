import { Separator } from './ui/separator'

export interface AuthDividerProps {
  label: string
}

/**
 * The "OR" divider shadcn auth cards place between a form and its social
 * sign-in buttons. Takes the label as a prop (rather than owning any
 * translation) and no opinion on which side of a form it sits on — see
 * design doc 2026-11-02 §3, "New: AuthDivider".
 */
export function AuthDivider({ label }: AuthDividerProps) {
  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-body-sm text-muted-foreground">{label}</span>
      <Separator className="flex-1" />
    </div>
  )
}
