import type { ReactNode } from 'react'

// Wraps a form control with a visible label in the new design (in the
// classic design the label is hidden and the layout is unchanged), so a
// filled-in box still says what it is.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="ui-new-only mb-1 text-sm font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  )
}
