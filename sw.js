// ===================================================================
// Service Worker para AESF Banco de Preguntas
// ===================================================================
//
// CÓMO ACTUALIZAR LA APP DESPUÉS DE SUBIR CAMBIOS A GITHUB:
//   Cambia el número de SW_VERSION abajo (ej: '1.0.0' → '1.0.1').
//   Eso invalida toda la caché y fuerza descarga de archivos nuevos.
//
// El SW se actualiza solo cuando la app se abre. La primera vez tras
// subir cambios instala la nueva versión; al cerrar y reabrir la app
// se aplica.
// ===================================================================

const SW_VERSION = '1.0.3';   // <-- cámbiame al subir cambios
const CACHE_NAME = `aesf-static-${SW_VERSION}`;
const CACHE_DYNAMIC = `aesf-dynamic-${SW_VERSION}`;

const PRECACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

// ============ INSTALACIÓN ============
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.allSettled(
                PRECACHE.map(url => cache.add(url).catch(err => console.warn('SW: no se pudo cachear', url, err)))
            );
        }).then(() => self.skipWaiting())
    );
});

// ============ ACTIVACIÓN: borrar TODAS las cachés viejas ============
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME && k !== CACHE_DYNAMIC)
                    .map(k => {
                        console.log('SW: borrando caché vieja', k);
                        return caches.delete(k);
                    })
            )
        ).then(() => self.clients.claim())
    );
});

// ============ FETCH ============
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET') return;

    // Network-first para preguntas.json e index.html
    if (url.pathname.endsWith('/preguntas.json') ||
        url.pathname.endsWith('preguntas.json') ||
        url.pathname.endsWith('/index.html') ||
        url.pathname.endsWith('/')) {
        event.respondWith(
            fetch(event.request)
                .then(res => {
                    if (res && res.status === 200) {
                        const copia = res.clone();
                        caches.open(CACHE_DYNAMIC).then(c => c.put(event.request, copia));
                    }
                    return res;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Imágenes: network-first así si las subes aparecen sin esperar
    if (event.request.destination === 'image' || url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
        event.respondWith(
            fetch(event.request)
                .then(res => {
                    if (res && res.status === 200) {
                        const copia = res.clone();
                        caches.open(CACHE_DYNAMIC).then(c => c.put(event.request, copia));
                    }
                    return res;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Fuentes Google: cache-first
    if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(res => {
                    const copia = res.clone();
                    caches.open(CACHE_DYNAMIC).then(c => c.put(event.request, copia));
                    return res;
                });
            })
        );
        return;
    }

    // CDN externos: cache-first
    if (url.hostname.includes('cdnjs.cloudflare.com')) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(res => {
                    const copia = res.clone();
                    caches.open(CACHE_DYNAMIC).then(c => c.put(event.request, copia));
                    return res;
                });
            })
        );
        return;
    }

    // Resto (CSS, JS): network-first para ver cambios
    event.respondWith(
        fetch(event.request)
            .then(res => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copia = res.clone();
                    caches.open(CACHE_DYNAMIC).then(c => c.put(event.request, copia));
                }
                return res;
            })
            .catch(() => {
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
