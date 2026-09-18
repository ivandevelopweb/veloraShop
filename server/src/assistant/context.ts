import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const contextFile = fileURLToPath(new URL('../../store-context.md', import.meta.url))
let contextPromise: Promise<string> | undefined

export function getStoreContext() {
  contextPromise ??= readFile(contextFile, 'utf8')
    .then((content) => content.slice(0, 20_000))
    .catch(() => 'Velora is a Ukrainian online store with products, delivery, payment and returns information.')
  return contextPromise
}
