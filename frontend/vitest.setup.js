import '@testing-library/jest-dom/vitest'

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
