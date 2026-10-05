import * as React from 'react'
import { cn } from '../lib/utils'
import { Label } from './ui/label'

export interface OtpInputProps {
  length?: number
  value: string
  onChange: (value: string) => void
  label?: string
  error?: string
  id?: string
  disabled?: boolean
  autoFocus?: boolean
  /** Applied to the first digit box only, so tests can target the group with a single query. */
  'data-testid'?: string
  /**
   * Accessible label for each individual digit box, e.g. "Digit {n}".
   * `packages/ui` has no i18n of its own (see `AuthCard.logoAlt`), so
   * localized callers should pass a translated template with a `{n}`
   * placeholder. Defaults to the English pattern.
   */
  digitAriaLabel?: (position: number, total: number) => string
}

export const OtpInput = React.forwardRef<HTMLDivElement, OtpInputProps>(function OtpInput(
  {
    length = 6,
    value,
    onChange,
    label,
    error,
    id,
    disabled,
    autoFocus,
    digitAriaLabel = (position, total) => `Digit ${position} of ${total}`,
    'data-testid': testId,
  },
  ref,
) {
  const reactId = React.useId()
  const fieldId = id ?? reactId
  const errorId = error ? `${fieldId}-error` : undefined
  const inputRefs = React.useRef<Array<HTMLInputElement | null>>([])

  // Focus moves are requested here rather than fired synchronously from
  // inside the change/keydown handlers below. Calling `.focus()` directly in
  // those handlers races with React committing the controlled `value` update
  // that triggered the move (e.g. retyping over an already-filled box after
  // a wrong code): focus would land on the next box for an instant and then
  // get reverted to the document body once React's commit landed, so typing
  // never actually advanced. Running the focus change in an effect — after
  // the commit — avoids the race.
  const [pendingFocusIndex, setPendingFocusIndex] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (pendingFocusIndex === null) return
    inputRefs.current[pendingFocusIndex]?.focus()
    setPendingFocusIndex(null)
  }, [pendingFocusIndex])

  const digits = React.useMemo(() => {
    const chars = value.split('').slice(0, length)
    return Array.from({ length }, (_, i) => chars[i] ?? '')
  }, [value, length])

  function setDigitAt(index: number, digit: string) {
    const next = digits.slice()
    next[index] = digit
    onChange(next.join('').replace(/\s+$/, ''))
  }

  // Typing into a box, as opposed to pasting (see handlePasteDistribute
  // below). There's deliberately no `maxLength` on the input — relying on it
  // to cap a single already-filled box at one character meant the browser
  // silently swallowed the keystroke whenever that box's existing digit
  // wasn't selected (e.g. retyping a code after a wrong attempt, where
  // nothing is focused/selected going in), so nothing happened and focus
  // never advanced. Letting the native value grow instead and always taking
  // its LAST character as the intended digit — the one the user just typed,
  // since typing appends at the end — works whether the box started empty
  // or already held a digit, and the controlled `value` prop clamps the
  // display back to one character on the next render regardless.
  function handleTypedChange(index: number, raw: string) {
    const digitsOnly = raw.replace(/\D/g, '')
    if (!digitsOnly) {
      setDigitAt(index, '')
      return
    }
    setDigitAt(index, digitsOnly.slice(-1))
    if (index < length - 1) {
      setPendingFocusIndex(index + 1)
    }
  }

  // Pasting several digits at once: distribute them across this box and the
  // ones after it.
  function handlePasteDistribute(index: number, pasted: string) {
    const incoming = pasted.replace(/\D/g, '')
    if (!incoming) return
    const next = digits.slice()
    let cursor = index
    for (const char of incoming) {
      if (cursor >= length) break
      next[cursor] = char
      cursor += 1
    }
    onChange(next.join('').replace(/\s+$/, ''))
    setPendingFocusIndex(Math.min(cursor, length - 1))
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault()
      setDigitAt(index - 1, '')
      setPendingFocusIndex(index - 1)
      return
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      setPendingFocusIndex(index - 1)
      return
    }
    if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault()
      setPendingFocusIndex(index + 1)
    }
  }

  function handlePaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text')
    if (!pasted) return
    e.preventDefault()
    handlePasteDistribute(index, pasted)
  }

  return (
    <div ref={ref} className="flex flex-col gap-1.5">
      {label && <Label id={`${fieldId}-label`}>{label}</Label>}
      <div className="flex gap-2" role="group" aria-labelledby={label ? `${fieldId}-label` : undefined}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              inputRefs.current[index] = el
            }}
            id={`${fieldId}-${index}`}
            data-testid={index === 0 ? testId : undefined}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            value={digit}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            aria-label={digitAriaLabel(index + 1, length)}
            aria-invalid={!!error}
            aria-describedby={errorId}
            onChange={(e) => handleTypedChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={(e) => handlePaste(index, e)}
            onFocus={(e) => e.target.select()}
            // A mouse click into a box that already holds a digit positions
            // the text cursor at the click point rather than selecting it —
            // the browser does this as part of its native click handling,
            // which runs AFTER the focus event, so it overrides the
            // onFocus select() above. Without a full selection, typing
            // inserts at the click position instead of replacing the
            // digit, which `handleTypedChange` isn't expecting. Reasserting
            // the selection on mouseup (which fires after that native
            // positioning) guarantees the box is always fully selected
            // before a keystroke can land, regardless of focus origin.
            onMouseUp={(e) => {
              e.preventDefault()
              e.currentTarget.select()
            }}
            className={cn(
              'h-12 w-10 rounded-md border border-input bg-background text-center text-headline-sm',
              'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
        ))}
      </div>
      {error && (
        <p id={errorId} className="text-label-md text-destructive">
          {error}
        </p>
      )}
    </div>
  )
})
