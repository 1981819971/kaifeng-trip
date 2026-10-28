/* 汴京秋行 2.0 · 汴京舆图（合规示意图）+ 定位打卡 + 顺路动线 + 一键导航 */
(function () {
  const { $, $$, esc, toast } = UI;
  const C = window.SPOT_COORDS, L = window.MAP_LAYOUT, META = window.MAP_META, DAYS = window.SPOT_DAYS;
  const DAY_COLORS = { d1: "#5a8fbf", d2: "#e8833a", d3: "#c9482f", d4: "#6b3fa0", d5: "#4f8a5b", d6: "#b06a9e" };
  /* 日程标题统一从 TRIP_DAYS 生成，与行程页/日志/向导口径一致 */
  const DAY_NAMES = Object.fromEntries((window.TRIP_DAYS || []).map((d, i) => [d.id, "D" + (i + 1) + " " + d.theme]));
  const CK_KEY = "bianjing.checkins";

  const dist = (a, b) => {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  const walkMin = (a, b) => Math.max(1, Math.round(dist(a, b) * META.detour / META.walkMPM));
  const fmtWalk = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + "分" : ""}` : `${m} 分钟`;
  const distStr = m => m >= 1000 ? (m / 1000).toFixed(1) + " km" : m + " m";

  function checkins() { try { return JSON.parse(localStorage.getItem(CK_KEY) || "{}"); } catch { return {}; } }
  function saveCheckins(o) { localStorage.setItem(CK_KEY, JSON.stringify(o)); }

  /* ---------- 舆图 SVG ---------- */
  function renderMap() {
    const svg = $("#mapSvg");
    const pts = Object.keys(L).map(name => {
      const p = L[name], c = C[name] || {};
      const day = (DAYS[name] || [])[0];
      return { name, x: p.x, y: p.y, day, color: day ? DAY_COLORS[day] : "#8a8378", area: c.area || "" };
    });
    svg.innerHTML = `
      <defs>
        <pattern id="mapPaper" width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill="#f7f1e2"/><path d="M26 0H0v26" fill="none" stroke="#ece3d2" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="680" height="520" fill="url(#mapPaper)" rx="14"/>
      <text x="20" y="30" font-size="13" fill="#b9b0a0">北 ↑</text>
      <path d="M120,520 C150,380 260,300 330,180 C365,115 380,60 385,0" fill="none" stroke="#bcd3e2" stroke-width="10" opacity=".55" stroke-linecap="round"/>
      <text x="330" y="330" font-size="12" fill="#8fb4d4" transform="rotate(-62 330 330)">汴河 · 包公湖水系</text>
      <rect x="480" y="140" width="150" height="80" rx="10" fill="#e3ecda" opacity=".8"/>
      <text x="555" y="185" font-size="12" fill="#6f9557" text-anchor="middle">铁塔 · 老河大方向</text>
      <g font-size="12" font-family="inherit">
        ${pts.map(p => `
          <g class="map-pt ${checkins()[p.name] ? "lit" : ""}" data-mapspot="${esc(p.name)}" transform="translate(${(p.x / 100 * 640 + 20).toFixed(1)},${(p.y / 100 * 470 + 25).toFixed(1)})" tabindex="0" role="button" aria-label="${esc(p.name)}">
            <circle r="17" fill="#fffdf6" stroke="${p.color}" stroke-width="2.5"/>
            ${checkins()[p.name] ? '<circle r="8" fill="' + p.color + '"/><path d="M-4 0l3 3 5.5-6" stroke="#fffdf6" stroke-width="2" fill="none" stroke-linecap="round"/>' : `<circle r="7" fill="${p.color}" opacity=".85"/>`}
            <text y="32" text-anchor="middle" fill="#3a352c" font-size="11.5" font-weight="600">${esc(p.name.length > 6 ? p.name.slice(0, 6) + "…" : p.name)}</text>
            ${p.day ? `<circle cx="12" cy="-12" r="8" fill="${p.color}"/><text x="12" y="-8.6" text-anchor="middle" font-size="8.5" fill="#fffdf6" font-weight="700">${p.day.replace("d", "D")}</text>` : ""}
          </g>`).join("")}
      </g>`;
    svg.querySelectorAll("[data-mapspot]").forEach(g => {
      g.onclick = () => popup(g.dataset.mapspot);
      g.onkeydown = e => { if (e.key === "Enter") popup(g.dataset.mapspot); };
    });
    // 图例
    $("#mapLegend").innerHTML = Object.keys(DAY_COLORS).map(d =>
      `<span class="lg"><i style="background:${DAY_COLORS[d]}"></i>${DAY_NAMES[d]}</span>`).join("");
    $("#mapNote").textContent = META.disclaimer;
  }

  function popup(name) {
    const c = C[name], box = $("#mapPop");
    const day = (DAYS[name] || []).map(d => DAY_NAMES[d]).join(" / ") || "自由安排";
    const home = c ? fmtWalk(walkMin(C["暖阳小院民宿"], c)) : null;
    box.innerHTML = `<div class="mp-head"><b>${esc(name)}</b><button class="mp-x" id="mapPopX" aria-label="关闭">✕</button></div>
      <p class="mp-line">🗓 ${esc(day)}</p>
      ${c ? `<p class="mp-line">📍 ${esc(c.addr)}</p><p class="mp-line">🚶 距民宿约 ${home}（直线推算）</p>` : ""}
      <div class="mp-ops">
        <a class="btn sky sm" href="https://uri.amap.com/search?keyword=${encodeURIComponent(name)}&city=410200&src=bianjing&callnative=1" target="_blank" rel="noopener">🧭 高德导航</a>
        <button class="btn primary sm" id="mpGuide">📖 活攻略</button>
      </div>`;
    box.classList.add("show");
    $("#mapPopX").onclick = () => box.classList.remove("show");
    $("#mpGuide").onclick = () => {
      box.classList.remove("show");
      document.querySelector(`#spotGrid .spot[data-spot="${CSS.escape(name)}"] [data-expand]`)?.click();
      const el = document.getElementById("spot-" + encodeURIComponent(name));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    };
  }

  /* ---------- 定位打卡 ---------- */
  function renderCheckin() {
    const n = Object.keys(checkins()).length;
    $("#checkinBar").innerHTML = `
      <div class="ck-left">🏮 已点亮 <b>${n}</b> / ${Object.keys(L).length - 1} 处</div>
      <button class="btn sky sm" id="ckBtn">📍 实时定位打卡</button>
      <small class="ck-note">坐标只存在本机（localStorage），不上传服务器</small>`;
    $("#ckBtn").onclick = () => {
      if (!navigator.geolocation) return toast("这台设备不支持定位", "warn");
      toast("正在定位…请站在点位 250 米内");
      navigator.geolocation.getCurrentPosition(pos => {
        const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const ck = checkins();
        let lit = 0;
        Object.keys(C).forEach(name => {
          if (name === "开封博物馆") return;
          if (dist(me, C[name]) < 250 && !ck[name]) { ck[name] = Date.now(); lit++; }
        });
        if (lit) { saveCheckins(ck); toast(`🎉 点亮 ${lit} 处！`); renderMap(); renderCheckin(); renderRoutes(); }
        else {
          const near = Object.keys(C).map(n2 => ({ n: n2, d: dist(me, C[n2]) })).sort((a, b) => a.d - b.d)[0];
          toast(`附近 250 米内没有可点亮点位（最近：${near.n}，${distStr(near.d)}）`, "warn");
        }
      }, err => toast("定位失败：" + err.message, "warn"), { enableHighAccuracy: true, timeout: 10000 });
    };
  }

  /* ---------- 顺路规划引擎（最近邻 + 拖拽调序） ---------- */
  let routeOrder = {};
  function autoRoute(day) {
    const spots = Object.keys(DAYS).filter(n => DAYS[n].includes(day) && C[n]);
    if (!spots.length) return [];
    const home = C["暖阳小院民宿"];
    const rest = spots.slice(), out = []; let cur = home;
    while (rest.length) {
      rest.sort((a, b) => walkMin(cur, C[a]) - walkMin(cur, C[b]));
      const nxt = rest.shift();
      out.push({ name: nxt, walk: walkMin(cur, C[nxt]) });
      cur = C[nxt];
    }
    return out;
  }
  function renderRoutes() {
    const box = $("#routeList");
    const days = Object.keys(DAY_COLORS);
    const active = routeOrder._day || "d1";
    box.innerHTML = `<div class="route-days">${days.map(d =>
      `<button class="chip ${d === active ? "active" : ""}" data-rday="${d}">${d.replace("d", "D")}</button>`).join("")}</div>` +
      `<p class="route-tip">引擎按「步行最短」自动串当日点位；拖动条目手动调序，步行时间实时重算。</p>` +
      `<ol class="route-ol">${currentRoute(active).map((r, i) => `
        <li draggable="true" data-ri="${i}" data-rname="${esc(r.name)}">
          <span class="ro-dot" style="background:${DAY_COLORS[active]}"></span>
          <div class="ro-main"><b>${esc(r.name)}</b><small>${i === 0 ? "首站" : "🚶 步行约 " + fmtWalk(r.walk) + " 自上一站"}</small></div>
          <span class="ro-drag" aria-hidden="true">⠿</span>
        </li>`).join("") || `<li class="gd-empty">这一天没有点位数据</li>`}</ol>`;
    $$("#routeList [data-rday]").forEach(b => b.onclick = () => { routeOrder._day = b.dataset.rday; renderRoutes(); });
    bindDrag(box, active);
  }
  function currentRoute(day) {
    if (routeOrder[day]) return routeOrder[day];
    routeOrder[day] = autoRoute(day);
    return routeOrder[day];
  }
  function rewalk(day) {
    const arr = routeOrder[day];
    for (let i = 1; i < arr.length; i++) arr[i].walk = walkMin(C[arr[i - 1].name], C[arr[i].name]);
    if (arr.length) arr[0].walk = walkMin(C["暖阳小院民宿"], C[arr[0].name]);
  }
  function bindDrag(box, day) {
    let dragIdx = null;
    box.querySelectorAll("li[data-ri]").forEach(li => {
      li.addEventListener("dragstart", () => { dragIdx = +li.dataset.ri; li.classList.add("dragging"); });
      li.addEventListener("dragend", () => { li.classList.remove("dragging"); });
      li.addEventListener("dragover", e => e.preventDefault());
      li.addEventListener("drop", e => {
        e.preventDefault();
        const to = +li.dataset.ri;
        if (dragIdx === null || dragIdx === to) return;
        const arr = currentRoute(day);
        const [moved] = arr.splice(dragIdx, 1);
        arr.splice(to, 0, moved);
        rewalk(day);
        renderRoutes();
      });
    });
  }

  async function init() {
    if (!$("#mapSvg")) return;
    renderMap(); renderCheckin(); renderRoutes();
    document.addEventListener("click", e => { if (!e.target.closest("#mapPop") && !e.target.closest("[data-mapspot]")) $("#mapPop").classList.remove("show"); });
  }
  window.MapView = { init };
})();
