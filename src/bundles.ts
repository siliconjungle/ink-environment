export async function enableBundles(base: string) {
  if (!("serviceWorker" in navigator))
    throw Error(
      "This browser needs service workers to load locally compiled Ink bundles.",
    );
  await navigator.serviceWorker.register(new URL("environment-sw.js", base), {
    scope: base,
  });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Reload once to enable the local bundle loader.")),
        10000,
      );
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
}
