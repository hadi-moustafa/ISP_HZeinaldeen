import { useEffect, useRef, type ReactNode } from 'react'

const MODAL_HISTORY_MARKER = 'ispModalOpen'

export function Modal({
  open,
  onClose,
  title,
  children,
  compact = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  // Tighter, and sized to the visible screen (dvh excludes the phone
  // browser's bars), for a form that has to fit without scrolling.
  compact?: boolean
}) {
  // Ref so the effect below doesn't need onClose in its dependency array --
  // parent components pass a fresh function every render, which would
  // otherwise tear down and re-push history on every keystroke inside the
  // modal's form.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Pressing the phone/browser back button while a modal is open should
  // close the modal and keep you on the page you were already on -- not pop
  // the app's real navigation history and dump you back on whatever route
  // you were on before this one (e.g. Pay modal open on Subscribers after
  // coming from Services -> back closed the modal *and* jumped to
  // Services). We push a throwaway same-URL history entry the moment the
  // modal opens and treat any back-press while it's open as "close the
  // modal" instead of "navigate". If the modal instead closes normally
  // (Cancel/backdrop/X/successful submit), the cleanup below pops that same
  // throwaway entry itself so it never lingers to eat a *later*, unrelated
  // back press once the modal is already closed.
  useEffect(() => {
    if (!open) return
    window.history.pushState({ [MODAL_HISTORY_MARKER]: true }, '')
    const onPopState = () => {
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      if ((window.history.state as Record<string, unknown> | null)?.[MODAL_HISTORY_MARKER]) {
        window.history.back()
      }
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md overflow-y-auto rounded-t-lg bg-white dark:bg-neutral-800 sm:rounded-lg ${
          compact ? 'max-h-[98dvh] p-3' : 'max-h-[90vh] p-4'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-4'}`}>
          <h2
            className={`font-semibold text-neutral-900 dark:text-neutral-100 ${
              compact ? 'truncate text-base' : 'text-lg'
            }`}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-2xl leading-none text-neutral-400"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
