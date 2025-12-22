/**
 * Clean up any previously registered service workers and their caches.
 * Some users reported console warnings originating from stale service workers
 * (e.g. "jamToggleDumpStore" handlers) that were left over from older builds.
 * Running this at startup ensures the app runs without any legacy workers.
 */
export function cleanupServiceWorkers(): void {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().catch(() => {
          // Ignore errors during cleanup; we only need to ensure workers are removed
        });
      });
    })
    .catch(() => {
      // Ignore errors during cleanup; the browser may block service worker APIs in some contexts
    });

  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
  }
}
