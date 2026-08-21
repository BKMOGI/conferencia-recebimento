const CACHE_NAME = "conferencia-recebimento-v4";

// Bibliotecas grandes que quase nunca mudam: cache primeiro (funcionam offline).
const VENDOR_ASSETS = [
  "./vendor/tesseract.min.js",
  "./vendor/worker.min.js",
  "./vendor/tesseract-core-simd.wasm.js",
  "./vendor/tesseract-core-simd.wasm",
  "./vendor/lang/por.traineddata.gz",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/xlsx.full.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Código do app: muda com frequência — busca da rede primeiro, cache é só fallback offline.
const APP_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/nfeParser.js",
  "./js/ocrParser.js",
  "./js/catalogParser.js",
  "./js/barcodeScanner.js",
  "./js/export.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([...APP_ASSETS, ...VENDOR_ASSETS]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

function isVendorAsset(url) {
  return url.pathname.includes("/vendor/") || url.pathname.includes("/icons/");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isVendorAsset(url)) {
    // Cache-first: bibliotecas grandes, não mudam entre versões do app.
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      }))
    );
    return;
  }

  // Network-first: código do app, pra sempre pegar a versão mais nova quando online.
  // {cache:"no-cache"} é essencial aqui — o GitHub Pages manda Cache-Control:
  // max-age=600 nos arquivos, e um fetch() comum respeita o cache HTTP do
  // navegador (não só o Cache Storage do service worker), então sem isso a
  // "busca da rede" podia devolver uma cópia de até 10 min atrás mesmo com
  // internet disponível.
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
