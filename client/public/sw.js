// Basic service worker for PWA installability
const CACHE_NAME = 'yomi-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Let the browser handle everything normally
  // This is just a dummy fetch handler to satisfy PWA requirements
  return;
});
