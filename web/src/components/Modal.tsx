import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

/** Open modals, innermost last: Escape closes only the topmost one when dialogs are stacked. */
const stack: object[] = []

export function anyModalOpen(): boolean {
  return stack.length > 0
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  width?: string
}) {
  const token = useRef({})
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const me = token.current
    stack.push(me)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === me) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = stack.lastIndexOf(me)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh] backdrop-blur-[1px]" onMouseDown={onClose}>
      <div
        className={clsx('card w-full shadow-2xl', width)}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="text-sm font-semibold">{title}</div>
            <button className="btn btn-ghost px-1.5" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
