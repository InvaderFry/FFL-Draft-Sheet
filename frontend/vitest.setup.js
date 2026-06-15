import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// Reset persisted state between tests so components that write to localStorage
// (settings, sync config, draft marks) can't leak across cases in a file.
afterEach(() => {
  window.localStorage?.clear()
  window.sessionStorage?.clear()
})

function storageMock() {
  let values = new Map()
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
    clear: () => { values = new Map() },
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size },
  }
}

if (!window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    value: storageMock(),
    configurable: true,
  })
}

if (!window.sessionStorage) {
  Object.defineProperty(window, 'sessionStorage', {
    value: storageMock(),
    configurable: true,
  })
}
