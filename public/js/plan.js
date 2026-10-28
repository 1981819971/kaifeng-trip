/* 汴京秋行 · 行程交互（勾选 / 备选切换 / 云端同步） */
(function () {
  const { $, $$, esc, icon, toast } = UI;

  // 转义后解析 **粗体** 等行内标记（复用 md.js，避免裸星号上屏）
  const mdBold = s => (window.MD ? MD.inline(esc(s)) : esc(s));

  const state = {
    plan: null,      // {days:{d1:{done:[],useAlt:false},...}, pack:{...}}
    activeDay: "d1"
  };

  function defaultPlan() {
    const days = {};
    TRIP_DAYS.forEach(d => { days[d.id] = { done: [], useAlt: false }; });
    return { days };
  }

  function itemKey(dayId, i) { return `${dayId}-${i}`; }

  function progress(d) {
    const st = state.plan.days[d.id];
    return st.done.length / d.items.length;
  }

  function renderTabs() {
    const el = $("#dayTabs");
    el.innerHTML = TRIP_DAYS.map((d, i) => {
      const on = d.id === state.activeDay;
      return `<button class="day-tab ${on ? "active" : ""}" role="tab" data-day="${d.id}">
        <b>D${i + 1}</b><span>${d.theme}</span><small>${d.weekday}</small>
      </button>`;
    }).join("");
    el.onclick = e => {
      const b = e.target.closest("[data-day]");
      if (!b) return;
      state.activeDay = b.dataset.day;
      renderTabs(); renderDay();
    };
  }

  function renderDay() {
    const d = TRIP_DAYS.find(x => x.id === state.activeDay);
    const st = state.plan.days[d.id];
    const pct = Math.round(progress(d) * 100);
    const panel = `
      <div class="day-panel active" id="panel-${d.id}">
        <div class="day-head">
          <div>
            <h3>${esc(d.theme)} <span class="day-date">${d.date} ${d.weekday}</span></h3>
            <p class="day-sub">${esc(d.sub)}</p>
          </div>
          <div class="ring" data-pct="${pct}"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" fill="none" stroke="var(--border)" stroke-width="4"/><circle class="ring-fg" cx="22" cy="22" r="19" fill="none" stroke="var(--orange)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(pct / 100 * 119.4).toFixed(1)} 119.4" transform="rotate(-90 22 22)"/></svg><b>${pct}%</b></div>
        </div>
        <div class="tl">
          ${d.items.map((it, i) => {
            const key = itemKey(d.id, i);
            const done = st.done.includes(key);
            return `<div class="tl-item ${done ? "done" : ""}" data-key="${key}">
              <div class="tl-dot"></div>
              <div class="tl-card">
                <div class="tl-top">
                  <label class="cb" title="勾选完成"><input type="checkbox" ${done ? "checked" : ""} data-check="${key}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></label>
                  <span class="tl-time">${esc(it.time)}</span><b>${esc(it.title)}</b>
                  ${it.tags ? `<span class="tl-tags">${it.tags.map(t => `<i class="tag">${esc(t)}</i>`).join("")}</span>` : ""}
                </div>
                <p>${mdBold(it.desc)}</p>
              </div>
            </div>`;
          }).join("")}
        </div>
        <div class="alt-card">
          <b>🔄 备选方案：${esc(d.alt.title)}</b>
          <p>${mdBold(d.alt.desc)}</p>
          <button class="btn ghost sm ${st.useAlt ? "active" : ""}" data-alt>${st.useAlt ? "已标记采用备选 ✓" : "标记采用此备选"}</button>
        </div>
      </div>`;

    const holder = $("#dayPanels");
    holder.innerHTML = panel;

    holder.querySelectorAll("[data-check]").forEach(cb => {
      cb.onchange = () => {
        const key = cb.dataset.check;
        const arr = state.plan.days[d.id].done;
        const idx = arr.indexOf(key);
        if (cb.checked && idx < 0) arr.push(key);
        if (!cb.checked && idx >= 0) arr.splice(idx, 1);
        if (cb.checked) burst(cb);
        Store.syncPlan(state.plan);
        renderDay();
      };
    });
    const altBtn = holder.querySelector("[data-alt]");
    if (altBtn) altBtn.onclick = () => {
      state.plan.days[d.id].useAlt = !state.plan.days[d.id].useAlt;
      Store.syncPlan(state.plan);
      renderDay();
      toast(state.plan.days[d.id].useAlt ? "已标记备选方案" : "已取消备选标记");
    };
  }

  /* 打勾时的小彩带 */
  function burst(el) {
    if (!window.confetti || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    confetti({
      particleCount: 26, spread: 50, startVelocity: 22, scalar: 0.8,
      origin: { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight },
      colors: ["#e8833a", "#5a8fbf", "#ff6b9d", "#6b3fa0"]
    });
  }

  async function init(remotePlan) {
    state.plan = Object.assign(defaultPlan(), remotePlan || {});
    // 补齐新数据里可能新增的日期
    TRIP_DAYS.forEach(d => { if (!state.plan.days[d.id]) state.plan.days[d.id] = { done: [], useAlt: false }; });
    // 云端自定义日程（向导改过的行程）覆盖本地数据
    const custom = (remotePlan && remotePlan.custom) || {};
    TRIP_DAYS.forEach(d => {
      if (custom[d.id] && Array.isArray(custom[d.id].items) && custom[d.id].items.length) {
        d.items = custom[d.id].items;
      }
    });
    state.plan.custom = custom;
    renderTabs();
    renderDay();
  }

  /* 向导补丁：{days:{dX:{items:[...]}}} —— 确认后替换该天日程并同步云端 */
  function applyPatch(patch) {
    const applied = [];
    Object.entries(patch.days || {}).forEach(([id, p]) => {
      const d = TRIP_DAYS.find(x => x.id === id);
      if (!d || !Array.isArray(p.items) || !p.items.length) return;
      d.items = p.items.map(it => ({
        time: String(it.time || ""), title: String(it.title || ""), desc: String(it.desc || ""),
        ...(Array.isArray(it.tags) && it.tags.length ? { tags: it.tags.map(String) } : {})
      }));
      const prev = state.plan.days[id] || { done: [], useAlt: false };
      state.plan.days[id] = { done: [], useAlt: !!prev.useAlt };  // 日程变了，勾选进度清零
      state.plan.custom = state.plan.custom || {};
      state.plan.custom[id] = { items: d.items };
      applied.push(`D${TRIP_DAYS.indexOf(d) + 1}`);
    });
    if (!applied.length) return false;
    Store.syncPlan(state.plan);
    state.activeDay = TRIP_DAYS.find(d => patch.days[d.id])?.id || state.activeDay;
    renderTabs();
    renderDay();
    return applied;
  }

  window.Plan = { init, state, applyPatch };
})();
