import { useSyncExternalStore } from 'react'

// Which look the app uses. 'classic' is the original design; 'new' is the
// plain white-and-blue design (src/styles/new-design.css). Both run the
// same pages -- the choice only sets data-ui on <html>, and the new
// design's stylesheet re-skins everything under [data-ui="new"].
// Saved per device, so each staff member's phone keeps its own choice.
export type UiDesign = 'classic' | 'new'

const STORAGE_KEY = 'isp:ui-design'
const THEME_COLOR: Record<UiDesign, string> = { classic: '#4f46e5', new: '#1d4ed8' }
const listeners = new Set<() => void>()

export function getUiDesign(): UiDesign {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'new' ? 'new' : 'classic'
  } catch {
    return 'classic'
  }
}

// Called once in main.tsx before the first render (so the page never
// flashes the other design), and again on every switch.
export function applyUiDesign(design: UiDesign) {
  document.documentElement.dataset.ui = design
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[design])
}

export function setUiDesign(design: UiDesign) {
  try {
    localStorage.setItem(STORAGE_KEY, design)
  } catch {
    // Private mode etc. -- the switch still applies for this visit.
  }
  applyUiDesign(design)
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUiDesign(): UiDesign {
  return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.ui === 'new' ? 'new' : 'classic'))
}
