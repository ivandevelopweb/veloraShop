import { useCallback, useEffect, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'status'

export type ToastState = {
  kind: ToastKind
  message: string
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  const notify = useCallback((message: string, kind: ToastKind = 'status') => {
    setToast({ message, kind })
  }, [])

  const clearToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  return { toast, notify, clearToast }
}
