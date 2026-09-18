export function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    return saved ? (JSON.parse(saved) as T) : fallback
  } catch {
    return fallback
  }
}

export function readStoredString(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStoredString(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Local storage can be unavailable in private browsing or locked-down contexts.
  }
}
