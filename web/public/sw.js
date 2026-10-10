/**
 * Service worker for the Westcal Field mobile app.
 * HTML and /m are never cached so photo-fill updates reach the phone.
 */
const SHELL_CACHE = "westcal-field-shell-v34";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;
  const live =
    request.mode === "navigate" ||
    url.pathname === "/m" ||
    url.pathname === "/m/" ||
    url.pathname === "/mobile" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith("/sw.js") ||
    !url.pathname.includes("/assets/");
  if (live) {
    event.respondWith(fetch(request, { cache: "reload" }));
    return;
  }
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || Promise.reject()))
  );
});
