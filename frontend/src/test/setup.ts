import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const values = new Map<string, string>();
const localStorageMock: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => Array.from(values.keys())[index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, String(value)); },
};

// Node 22 exposes an incomplete experimental localStorage global in workers.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

// jsdom reports pseudo-element style lookups as unimplemented; Ant Design only
// needs the base element style when measuring scrollbars in component tests.
const nativeGetComputedStyle = window.getComputedStyle.bind(window);
Object.defineProperty(window, 'getComputedStyle', {
  configurable: true,
  value: (element: Element) => nativeGetComputedStyle(element),
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
