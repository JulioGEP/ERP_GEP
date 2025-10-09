import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, vi } from 'vitest';

beforeAll(() => {
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});
