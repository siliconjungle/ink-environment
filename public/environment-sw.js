// Virtual, locally compiled Ink bundles. Only this environment's namespace is intercepted.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const root = new URL("./bundles/", self.registration.scope);
  if (event.request.url.startsWith(root.href))
    event.respondWith(
      caches
        .open("ink-environment-bundles-v1")
        .then(
          async (cache) =>
            (await cache.match(event.request)) ??
            new Response("Compiled bundle expired. Compile again.", {
              status: 404,
            }),
        ),
    );
});
