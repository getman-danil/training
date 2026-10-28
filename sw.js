// Офлайн: всё приложение и картинки монстров лежат в кэше, открывается без интернета.
// При обновлении сайта поменяй VERSION — телефон подхватит новую версию при следующем открытии.
const VERSION = "v12";
const CACHE = "ashgob-" + VERSION;
const FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "game.js",
  "store.js",
  "analysis.js",
  "plan.js",
  "app.webmanifest",
  "assets/fonts/fonts.css",
  "assets/fonts/CormorantGaramond-400-cyrillic.woff2",
  "assets/fonts/CormorantGaramond-400-latin.woff2",
  "assets/fonts/CormorantGaramond-400i-cyrillic.woff2",
  "assets/fonts/CormorantGaramond-400i-latin.woff2",
  "assets/fonts/CormorantGaramond-600-cyrillic.woff2",
  "assets/fonts/CormorantGaramond-600-latin.woff2",
  "assets/fonts/CormorantSC-300-cyrillic.woff2",
  "assets/fonts/CormorantSC-300-latin.woff2",
  "assets/fonts/CormorantSC-500-cyrillic.woff2",
  "assets/fonts/CormorantSC-500-latin.woff2",
  "assets/fonts/CormorantSC-700-cyrillic.woff2",
  "assets/fonts/CormorantSC-700-latin.woff2",
  "assets/monsters/dragon-drake.webp",
  "assets/monsters/dragon-wyvern.webp",
  "assets/monsters/goblin-archer.webp",
  "assets/monsters/goblin-chief.webp",
  "assets/monsters/goblin-raider.webp",
  "assets/monsters/goblin-shaman.webp",
  "assets/monsters/orc-berserker.webp",
  "assets/monsters/orc-grunt.webp",
  "assets/monsters/orc-warg-rider.webp",
  "assets/monsters/undead-ghoul.webp",
  "assets/monsters/undead-skeleton.webp",
  "assets/monsters/undead-wraith.webp",
  "assets/icons/apple-180.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("ashgob-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Свои файлы: сначала сеть (чтобы обновления приходили), без сети — кэш. Запросы к GitHub API не трогаем.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // no-cache: сверяемся с сервером, иначе браузер до 10 минут отдаёт старые файлы из своего кэша.
  // Слабая сеть в зале не должна тормозить: через 2,5 с без ответа отдаём кэш.
  const cached = () => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"));
  const net = fetch(e.request, { cache: "no-cache" }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  });
  const slow = new Promise(res => setTimeout(res, 2500)).then(cached);
  e.respondWith(Promise.race([net.catch(cached), slow.then(r => r || net)]));
});
