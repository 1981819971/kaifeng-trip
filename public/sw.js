/* 汴京秋行 2.0 · Service Worker
 * 静态资源：cache-first（版本化 URL，更新即换版本号）
 * 页面导航：network-first，断网回退缓存的 index.html
 * API：network-first，失败回退缓存（离线可读行程/记账） */
"use strict";
const VER = "v20260923h";
const STATIC_CACHE = "bianjing-static-" + VER;
const RUNTIME_CACHE = "bianjing-runtime-" + VER;

const PRECACHE = [
  "/", "/index.html", "/manifest.webmanifest", "/favicon.svg",
  "/css/tokens.css", "/css/base.css", "/css/components.css", "/css/sections.css", "/css/blocks.css", "/css/v2.css",
  "/js/data-days.js", "/js/data-content.js", "/js/data-spotguide.js", "/js/data-extra.js", "/js/data-map.js",
  "/js/ui.js", "/js/md.js", "/js/store.js", "/js/plan.js", "/js/expenses.js",
  "/js/spots2.js", "/js/mapview.js", "/js/weather.js", "/js/journal.js", "/js/chat.js", "/js/app.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(STATIC_CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // CDN 字体/字体文件走网络

  /* API：network-first → 缓存回退（离线可读；只缓存成功响应，防坏状态码投毒） */
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then(r => r || new Response(JSON.stringify({ offline: true }), { headers: { "Content-Type": "application/json" } })))
    );
    return;
  }
  /* 页面导航：network-first */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then(c => c.put("/index.html", copy));
        return res;
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }
  /* 静态：cache-first + 后台更新 */
  e.respondWith(
    caches.match(req).then(hit => {
      const fetching = fetch(req).then(res => {
        if (res.ok) caches.open(RUNTIME_CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || fetching;
    })
  );
});
