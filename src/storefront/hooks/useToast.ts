import { useEffect, useState } from 'react'

export function useToast() {
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  return { toast, setToast }
}
