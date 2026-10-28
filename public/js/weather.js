/* 汴京秋行 2.0 · 实时天气 + 雨天规则高亮 + 演出当日模式 */
(function () {
  const { $, $$, esc, toast } = UI;
  const TRIP_ISO = { "10.01": "2026-10-01", "10.02": "2026-10-02", "10.03": "2026-10-03", "10.04": "2026-10-04", "10.05": "2026-10-05", "10.06": "2026-10-06" };
  /* 当日模式演出表（分钟制，与行程/攻略口径一致：打铁花 19:30 第一场 / 21:30 加场） */
  const TODAY_SHOWS = [
    { park: "清明上河园", name: "包公迎宾", mins: [9 * 60], tip: "开园第一戏，进园直奔广场" },
    { park: "开封府", name: "开衙迎宾", mins: [9 * 60], tip: "开衙仪式别迟到" },
    { park: "万岁山", name: "王婆说媒", mins: [10 * 60, 16 * 60 + 30, 19 * 60], tip: "多源场次不一，以当日节目单为准；茶楼二楼看台最佳" },
    { park: "万岁山", name: "三打祝家庄", mins: [11 * 60, 14 * 60, 17 * 60 + 30], tip: "提前 30–40 分钟占座，中后排防扬尘" },
    { park: "万岁山", name: "打铁花", mins: [19 * 60 + 30, 21 * 60 + 30], tip: "14:30 小程序抢 19:30 前排；不站第一排防灼伤" }
  ];
  const WX_ICON = code => (code === 0 || code === 1) ? "☀️" : code <= 3 ? "⛅" : code <= 48 ? "🌫" : code <= 67 ? "🌧" : code <= 77 ? "🌨" : code <= 82 ? "🌧" : "⛈";
  let weather = null;

  async function load() {
    try { weather = await Store.API.j("/api/weather"); } catch { weather = null; }
  }
  function byDate(iso) {
    const pick = arr => (arr ? arr.find(d => d.date === iso) : null);
    const t = (weather && weather.trip && weather.trip.days) ? pick(weather.trip.days) : null;
    const o = t || (weather && weather.days ? pick(weather.days) : null);
    if (!o) return null;
    /* 超出 16 天窗口的日期服务端返回 {date, none:"预报未出…"} 占位对象——此处统一返回 null，
       避免渲染出 undefined℃ / undefined% */
    if (typeof o.tmax !== "number" || typeof o.pop !== "number") return null;
    return o;
  }

  /* 每日行程标题栏天气 chip + 雨天规则 */
  function decoratePlan() {
    $$("#dayPanels .day-head").forEach(head => {
      if (head.querySelector(".wx-chip")) return;
      const panel = head.closest(".day-panel");
      const dayId = (panel.id || "").replace("panel-", "");
      const d = window.TRIP_DAYS.find(x => x.id === dayId);
      if (!d) return;
      const w = byDate(TRIP_ISO[d.date]);
      const chip = document.createElement("span");
      chip.className = "wx-chip" + (w && w.pop >= 60 ? " rain" : "");
      chip.innerHTML = w
        ? `${WX_ICON(w.code)} ${w.tmin}~${w.tmax}℃ · 降水 ${w.pop}%${w.place ? " · " + w.place : ""}`
        : `🗓 ${d.date} 预报未出（16 天窗口）`;
      head.querySelector("h3").after(chip);
      if (w && w.pop >= 60 && /万岁山/.test(d.items.map(i => i.title).join())) {
        panel.querySelector(".alt-card")?.classList.add("rain-alert");
        const note = document.createElement("div");
        note.className = "rain-note";
        note.innerHTML = `🌧️ <b>雨天规则已触发</b>：降水概率 ${w.pop}% ≥ 60%，万岁山户外剧（打铁花/马战/水幕秀）遇雨取消——建议与 D3 清园日对调（年卡随时能进、改期零成本），室内备选开封博物馆（免费，需预约，周一闭馆）。<b>赠票三日窗口跟着首入园日走，对调后要重新算。</b> 已自动通知小向导按此口径回答。`;
        panel.querySelector(".alt-card")?.before(note);
      } else if (w && w.pop >= 60 && d.id === "d5") {
        panel.querySelector(".alt-card")?.classList.add("rain-alert");
        const note = document.createElement("div");
        note.className = "rain-note";
        note.innerHTML = `🌧️ <b>雨天预案</b>：开封降水概率 ${w.pop}% ≥ 60%，万岁山（D2）与清园（D3/D5）可能对调，或启用各日「下雨版」行程——以行程页当日提示为准，博物馆为万能备胎（周一闭馆）。`;
        panel.querySelector(".alt-card")?.before(note);
      }
    });
    // 行程块顶横幅
    const banner = $("#wxBanner");
    if (banner && weather) {
      const rains = window.TRIP_DAYS.filter(d => { const w = byDate(TRIP_ISO[d.date]); return w && w.pop >= 60; });
      banner.innerHTML = weather.error ? `<span>⚠️ 天气服务暂不可用（${esc(weather.error)}），稍后自动重试</span>`
        : `<span>${weather.stale ? "⏳ 显示缓存预报（刷新失败）· " : ""}开封六日预报：${window.TRIP_DAYS.map(d => { const w = byDate(TRIP_ISO[d.date]); return `<b>${d.date}</b> ${w ? WX_ICON(w.code) + w.pop + "%" + (w.place ? "·" + esc(w.place) : "") : "—"}`; }).join(" · ")}${rains.length ? ` · <em>🌧️ ${rains.map(d => "D" + (window.TRIP_DAYS.indexOf(d) + 1)).join("、")} 降水偏高，已高亮备选</em>` : ""}${window.TRIP_DAYS.some(d => !byDate(TRIP_ISO[d.date])) ? " · <em>「—」为超出 16 天窗口，出发前再刷</em>" : ""}</span><small style="display:block;margin-top:4px;color:#8a8378">🌡️ 本站用国际模式预报（覆盖 16 天行程），与手机国内源可能差 1-2℃ 或一档现象；降水概率 = 全天最大概率，非「必下雨」——出行前以中国天气网为准</small>`;
      banner.hidden = false;
    }
  }

  /* 演出当日模式 */
  function todayMode() {
    const box = $("#todayMode");
    if (!box) return;
    const now = new Date();
    /* 本地日期。禁用 toISOString()——那是 UTC，北京时间 0-8 点会错位成「昨天」，
       曾把 10.1 早上算成 9.30 导致当日模式显示「旅途之外」 */
    const p2 = n => String(n).padStart(2, "0");
    const iso = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const dayKeys = Object.keys(TRIP_ISO);
    const dayIdx = dayKeys.find(k => TRIP_ISO[k] === iso);
    const dep = new Date("2026-09-30T19:42:00+08:00");
    if (now < dep) {
      const ms = dep - now, dd = Math.floor(ms / 86400000), hh = Math.floor(ms / 3600000) % 24;
      const label = dd > 0 ? `${dd} 天 ${hh} 小时` : `${Math.max(1, Math.floor(ms / 3600000))} 小时`;
      box.innerHTML = `<div class="tm-card"><b>🚄 距发车还有 ${label}</b><span>「当日模式」在旅途中自动切换：按当前时间排接下来该看的演出，并提醒占位时间。</span></div>`;
      return;
    }
    const mins = now.getHours() * 60 + now.getMinutes();
    /* 只列「今天行程里实际出现的园区」的演出：D1 抵达 / D4 免费日 / D6 返程没有大型演出 */
    const PARKS_BY_DAY = { d1: [], d2: ["万岁山"], d3: ["清明上河园"], d4: [], d5: ["清明上河园"], d6: [] };
    const parks = PARKS_BY_DAY[dayIdx] || [];
    const upcoming = [];
    TODAY_SHOWS.filter(s => parks.includes(s.park)).forEach(s => s.mins.forEach(m => { if (m >= mins - 30) upcoming.push({ ...s, m }); }));
    upcoming.sort((a, b) => a.m - b.m);
    const d = window.TRIP_DAYS.find(x => x.date === (dayIdx || ""));
    const headTxt = dayIdx ? "D" + (dayKeys.indexOf(dayIdx) + 1) + " " + (d ? d.theme : "") : "旅途之外";
    const emptyTxt = dayIdx
      ? (parks.length ? "今天的场次都散了——回民宿泡脚，明天赶早。" : "今天没有锁定的大型演出，按行程页节奏走就好。")
      : "当前不在行程日期内。";
    box.innerHTML = `<div class="tm-card live">
      <b>🎪 当日模式 · ${headTxt}（${iso}）</b>
      ${upcoming.length ? upcoming.slice(0, 4).map(s => {
        const left = s.m - mins;
        const t = `${Math.floor(s.m / 60)}:${String(s.m % 60).padStart(2, "0")}`;
        const leftTxt = left <= 30 ? "正在/即将开始" : `⏳ ${Math.floor(left / 60)}:${p2(left % 60)} 后开场`;
        return `<div class="tm-row"><span class="tm-time">${t}</span><b>${esc(s.name)}</b><small>${esc(s.park)}</small>
          <em>${leftTxt}</em>
          <p>💡 ${esc(s.tip)}</p></div>`;
      }).join("") : `<p class='gd-empty'>${emptyTxt}</p>`}
    </div>`;
  }

  async function init() {
    if (!$("#dayPanels")) return;
    await load();
    const obs = new MutationObserver(() => decoratePlan());
    obs.observe($("#dayPanels"), { childList: true, subtree: true });
    decoratePlan();
    todayMode();
    setInterval(todayMode, 60000);
    // 服务端骨架口径校验（雨天规则代码化）——拉一次让服务器也刷新缓存
    Store.API.j("/api/skeleton/d4").catch(() => { });
  }
  window.Weather = { init, byDate, TRIP_ISO };
})();
