/* 汴京秋行 2.0 · 景点详情卡（活攻略 + 周边觅食 + 经验沉淀） */
(function () {
  const { $, $$, esc, toast } = UI;
  const md = window.MD.md;
  const xhs = k => "https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(k);
  const dy = k => "https://www.douyin.com/search/" + encodeURIComponent(k);

  const GUIDE_KEY = { "天波杨府": "龙亭三馆", "中国翰园碑林": "龙亭三馆", "龙亭景区": "龙亭三馆", "龙亭公园": "龙亭三馆" };
  const TABS = [["facts", "📌 最新情报"], ["voice", "💬 游客真实说"], ["food", "🍜 觅食"], ["rev", "⭐ 大家说"]];

  let reviews = [];
  let people = ["三弦闲", "神神神"];

  /* 觅食行解析：表格或竖线分隔行 → [[店名,特色,人均,距离,亮点,来源], ...] */
  function parseFoodRows(text) {
    if (!text) return [];
    const out = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((ln, idx) => {
      if (!/\|/.test(ln)) return;
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(ln)) return;               // 分隔行
      const cells = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(s => s.trim());
      if (cells.length < 3) return;
      if (cells.every(c => /^(店名|特色|人均|距离|亮点|来源|备注|推荐)/.test(c)) && idx < 4) return; // 表头
      out.push(cells);
    });
    return out;
  }
  function navLinks(name) {
    const q = encodeURIComponent(name);
    return `<span class="nav-links">
      <a href="https://uri.amap.com/search?keyword=${q}&city=410200&src=bianjing&callnative=1" target="_blank" rel="noopener" title="高德地图">🧭 高德</a>
    </span>`;
  }

  function foodBlock(g) {
    const rows = parseFoodRows(g && g.food);
    if (!rows.length) return `<p class="gd-empty">周边餐馆情报整理中——先去 <a href="#food" data-jump="#food">食在汴梁</a> 看编辑精选清单。</p>`;
    return `<p class="gd-srcnote">✳️ 摘自游记与点评，含来源；人均/距离为作者口径。编辑精选看 <a href="#food" data-jump="#food">食在汴梁</a>。</p>
      <div class="food-near">${rows.slice(0, 6).map(r => `
        <div class="food-near-row">
          <b>${esc(r[0])}</b>
          <span>${r.slice(1, r.length - 1).filter(Boolean).map(esc).join(" · ")}</span>
          ${navLinks(r[0])}
          <div class="gd-src">${r[r.length - 1] || ""}</div>
        </div>`).join("")}</div>`;
  }

  async function loadReviews() {
    try { reviews = await Store.API.j("/api/reviews"); } catch { reviews = []; }
  }
  function reviewBlock(spot) {
    const mine = reviews.filter(r => r.spot === spot).sort((a, b) => b.ts - a.ts);
    const avg = mine.length ? (mine.reduce((s, r) => s + r.stars, 0) / mine.length).toFixed(1) : null;
    return `
      <div class="rev-avg">${avg ? `你们评过：<b class="rev-stars">★ ${avg}</b>（${mine.length} 条）` : "去过的话，留一句给未来的自己 👇"}</div>
      <div class="rev-list">${mine.map(r => `
        <div class="rev-row" data-rid="${r.id}">
          <span class="rev-who">${esc(people[r.author === "B" ? 1 : 0] || "同伴")}</span>
          <span class="rev-stars">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</span>
          <span class="rev-text">${esc(r.text)}</span>
          <button class="rev-del" data-delrev="${r.id}" aria-label="删除">✕</button>
        </div>`).join("") || `<p class="gd-empty">还没有点评——旅行中随手记，回校就是你们自己的《东京梦华录》。</p>`}</div>
      <form class="rev-form" data-revform="${esc(spot)}">
        <div class="rev-pick">
          <select data-revwho>${people.map((p, i) => `<option value="${i ? "B" : "A"}">${esc(p)}</option>`).join("")}</select>
          <div class="star-pick" data-stars> ${[1, 2, 3, 4, 5].map(n => `<i data-star="${n}">☆</i>`).join("")}</div>
        </div>
        <input data-revtext type="text" maxlength="120" placeholder="一句话点评，例：打铁花第一排worth，雨衣别忘带">
        <button class="btn sky sm" type="submit">记下</button>
      </form>`;
  }
  function bindReviewBox(scope) {
    $$("[data-revform]", scope).forEach(form => {
      let stars = 5;
      const starBox = form.querySelector("[data-stars]");
      const paint = () => $$("i", starBox).forEach(i => i.textContent = +i.dataset.star <= stars ? "★" : "☆");
      starBox.onclick = e => { const i = e.target.closest("[data-star]"); if (i) { stars = +i.dataset.star; paint(); } };
      form.onsubmit = async ev => {
        ev.preventDefault();
        const text = form.querySelector("[data-revtext]").value.trim();
        if (!text) return toast("写一句话再记吧", "warn");
        const r = await Store.API.j("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spot: form.dataset.revform, author: form.querySelector("[data-revwho]").value, stars, text }) }).catch(() => null);
        if (r) { reviews.push(r); const box = form.closest(".gd-tab"); box.innerHTML = reviewBlock(form.dataset.revform); bindReviewBox(box); toast("已沉淀 ✓"); }
        else toast("云端没连上，这条没存", "warn");
      };
    });
    $$("[data-delrev]", scope).forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.delrev;
      const r = await Store.API.j("/api/reviews/" + id, { method: "DELETE" }).catch(() => null);
      if (r) { reviews = reviews.filter(x => x.id !== id); refreshOpenRev(); toast("已删除"); }
    });
  }
  function refreshOpenRev() {
    $$(".gd-tab[data-revspot]").forEach(box => { box.innerHTML = reviewBox(box.dataset.revspot); bindReviewBox(box); });
  }

  function detailHTML(spotName) {
    const key = GUIDE_KEY[spotName] || spotName;
    const g = (window.SPOT_GUIDE || {})[key];
    if (!g) return `<p class="gd-empty">这个点位的深情报还在路上——先用上面的百度/团购链接探路。</p>`;
    return `
      <div class="gd-tabs" role="tablist">
        ${TABS.map(([k, label], i) => `<button class="gd-tabbtn ${i === 0 ? "active" : ""}" data-gdtab="${k}">${label}</button>`).join("")}
      </div>
      ${TABS.map(([k], i) => {
        let body;
        if (k === "rev") body = reviewBlock(spotName);
        else if (k === "food") body = foodBlock(g);
        else body = g[k] ? md(g[k]) : `<p class="gd-empty">未检索到可靠信息——以官方为准。</p>`;
        return `<div class="gd-tab ${i === 0 ? "active" : ""}" data-gdpane="${k}" ${k === "rev" ? `data-revspot="${esc(spotName)}"` : ""}>${body}</div>`;
      }).join("")}
      <p class="gd-channels">情报来源：小红书 · 抖音 · 马蜂窝 · 同程/携程点评 · 官方渠道 · 检索于 2026-09-15</p>`;
  }

  /* ---------- 基础卡渲染（从 app.js 迁移） ---------- */
  let spotCat = "all";
  function renderFilter() {
    $("#spotFilter").innerHTML = SPOT_FILTERS.map(f =>
      `<button class="chip ${f.key === spotCat ? "active" : ""}" data-f="${f.key}">${esc(f.label)}</button>`).join("");
    $("#spotFilter").onclick = e => {
      const b = e.target.closest("[data-f]"); if (!b) return;
      spotCat = b.dataset.f; renderFilter(); renderSpots();
    };
  }
  function renderSpots() {
    const list = SPOTS.filter(s => spotCat === "all" || s.cat === spotCat);
    const img = n => "img/spot-" + encodeURIComponent(n) + ".jpg";
    $("#spotGrid").innerHTML = list.map((s, i) => `
      <article class="spot card-lift has-guide" id="spot-${encodeURIComponent(s.name)}" style="--d:${i * 0.05}s" data-spot="${esc(s.name)}">
        <div class="spot-pic"><img src="${img(s.name)}" alt="${esc(s.name)}" loading="lazy" onerror="this.parentNode.classList.add('noimg')"></div>
        <div class="spot-body">
          <div class="spot-top"><h3>${esc(s.name)}</h3><span class="spot-score">★ ${s.score}</span></div>
          <div class="spot-meta">
            <span class="tag">${esc(s.hot)}</span><span class="tag">${esc(s.level)}</span>
            <span class="tag">${esc(s.hours)}</span><span class="tag">建议 ${esc(s.spend)}</span>
          </div>
          <p class="spot-desc">${esc(s.desc)}</p>
          <div class="spot-fee">
            <span class="fee">${s.price ? "¥" + s.price : "免费"}</span>
            ${s.stu != null && s.price ? `<span class="stu-badge">🎓 学生 ¥${s.stu}</span>` : ""}
            <small>${esc(s.addr)}</small>
          </div>
          ${s.deal ? `<div class="spot-deal">💡 ${(window.MD ? MD.inline(esc(s.deal)) : esc(s.deal))}</div>` : ""}
          <div class="spot-links">
            <button class="btn primary sm" data-expand>📖 活攻略</button>
            ${navLinks(s.name)}
            <a class="btn ghost sm" href="${dy(s.name + " 门票团购")}" target="_blank" rel="noopener">🎫 团购</a>
          </div>
          <div class="spot-detail" hidden></div>
        </div>
      </article>`).join("");

    $$("#spotGrid .spot").forEach(card => {
      card._open = false;
      card.onclick = e => {
        if (e.target.closest("a") || e.target.closest("[data-gdpane]") || e.target.closest(".rev-form")) return;
        const btn = e.target.closest("[data-expand]");
        if (!btn && !e.target.closest(".spot-pic") && !e.target.closest(".spot-top")) return;
        toggle(card);
      };
    });
  }
  function toggle(card, force) {
    const open = force !== undefined ? force : !card._open;
    card._open = open;
    const detail = card.querySelector(".spot-detail");
    if (open && !detail.dataset.built) {
      detail.innerHTML = detailHTML(card.dataset.spot);
      detail.dataset.built = "1";
      bindTabs(detail);
      bindReviewBox(detail);
    }
    detail.hidden = !open;
    card.classList.toggle("open", open);
    if (open) detail.querySelectorAll("a[data-jump]").forEach(a => a.onclick = ev => {
      ev.preventDefault();
      const t = document.getElementById(a.dataset.jump.slice(1));
      if (t) { t.scrollIntoView({ behavior: "smooth" }); location.hash = a.dataset.jump; }
    });
  }
  function bindTabs(scope) {
    $$(".gd-tabbtn", scope).forEach(b => b.onclick = () => {
      $$(".gd-tabbtn", scope).forEach(x => x.classList.toggle("active", x === b));
      $$(".gd-tab", scope).forEach(x => x.classList.toggle("active", x.dataset.gdpane === b.dataset.gdtab));
    });
  }

  /* 夜市卡也带详情（marketGrid） */
  function renderMarkets() {
    $("#marketGrid").innerHTML = NIGHT_MARKETS.map(m => `
      <div class="eat card-lift has-guide" data-spot="${esc(m.name)}">
        <div class="eat-body">
          <div class="eat-top"><span class="food-pill">${esc(m.type)}</span><b>${esc(m.name)}</b></div>
          <p class="eat-desc">${esc(m.desc)}</p>
          <p class="eat-must">🔑 必吃：${esc(m.pick)}</p>
          <div class="eat-foot">
            <small class="eat-loc">📍 开封</small>
            <span class="eat-links"><button class="btn primary sm" data-expand>📖 活攻略</button>${navLinks(m.name)}</span>
          </div>
          <div class="spot-detail" hidden></div>
        </div>
      </div>`).join("");
    $$("#marketGrid .eat").forEach(card => {
      card._open = false;
      card.onclick = e => {
        if (e.target.closest("a") || e.target.closest(".rev-form")) return;
        if (!e.target.closest("[data-expand]")) return;
        toggle(card);
      };
    });
    /* 美食总览（谁家最正宗 · 本地人去哪家）全幅可展开卡 */
    const fg = (window.SPOT_GUIDE || {})["美食总览"];
    if (fg) {
      $("#marketGrid").insertAdjacentHTML("beforeend", `
        <div class="eat card-lift has-guide food-master" data-spot="美食总览">
          <div class="eat-body">
            <div class="eat-top"><span class="food-pill">本地人口碑</span><b>谁家最正宗 · 速查</b></div>
            <p class="eat-desc">${esc((fg.route || "").split(/\n/).filter(Boolean)[0] || "灌汤包、桶子鸡、炒凉粉……谁家最正宗，一篇说清。").replace(/^\-+\s*/, "")}</p>
            <div class="eat-foot"><span class="eat-links"><button class="btn primary sm" data-expand>📖 展开</button></span></div>
            <div class="spot-detail" hidden></div>
          </div>
        </div>`);
      const card = $("#marketGrid .food-master");
      card._open = false;
      card.onclick = e => {
        if (e.target.closest("a") || e.target.closest(".rev-form")) return;
        if (!e.target.closest("[data-expand]")) return;
        toggle(card);
      };
    }
  }

  async function init() {
    try { const s = await Store.API.j("/api/settings"); if (s && s.people) people = s.people; } catch { }
    await loadReviews();
    renderFilter(); renderSpots(); renderMarkets();
  }
  window.SpotCard = { init, renderSpots, refreshReviews: refreshOpenRev };
})();
