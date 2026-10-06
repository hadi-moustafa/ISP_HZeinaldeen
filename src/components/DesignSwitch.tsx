import { setUiDesign, useUiDesign, type UiDesign } from '../lib/uiDesign'

const OPTIONS: [UiDesign, string][] = [
  ['classic', 'Classic'],
  ['new', 'New'],
]

// Two-button switch between the classic and the new design. Used in the
// menu drawer and on the login page.
export function DesignSwitch() {
  const design = useUiDesign()
  return (
    <div className="flex items-center gap-2 px-3">
      <span className="text-sm text-neutral-600">Design</span>
      <div className="ml-auto flex rounded-full bg-neutral-100 p-0.5">
        {OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setUiDesign(value)}
            aria-pressed={design === value}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              design === value ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
