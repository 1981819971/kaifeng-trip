/* 汴京秋行 · 四块架构（底部一级导航 + 块内目录侧栏 + 向导悬浮层）+ 主渲染 + 动效 */
(function () {
  const { $, $$, esc, icon, toast } = UI;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 外链搜索 helper（此前仅在 spots2.js 闭包内定义，app.js 引用会 ReferenceError）
  const xhs = k => "https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(k);
  const dy = k => "https://www.douyin.com/search/" + encodeURIComponent(k);
  // ?noanim 或爬虫/打印环境：跳过入场动画，保证内容始终可见
  const SKIP_ANIM = /[?&]noanim/.test(location.search) || navigator.webdriver;

  /* ---------------------------------------------------------------
     一级导航：四块（按「使用时机」划分）
     --------------------------------------------------------------- */
  const BLOCKS = {
    prep: {
      name: "行前",
      sub: "出发前，把事办妥",
      items: [
        { id: "budget",    label: "预算估算", icon: "wallet" },
        { id: "pack",      label: "打包清单", icon: "backpack" },
        { id: "tips",      label: "出行锦囊", icon: "lightbulb" }
      ]
    },
    plan: {
      name: "行程",
      sub: "六日逐日安排",
      items: []                       // 动态：D1–D6 + 旅行日志
    },
    guide: {
      name: "攻略",
      sub: "到景点 · 到饭点 · 到演出",
      items: [
        { id: "map",   label: "汴京舆图", icon: "map" },
        { id: "spots", label: "景点全图", icon: "camera" },
        { id: "food",  label: "食在汴梁", icon: "utensils" },
        { id: "shows", label: "演出时刻", icon: "ticket-check" }
      ]
    },
    money: {
      name: "账目",
      sub: "公摊记账与结算",
      items: [
        { id: "expenses", label: "公摊记账", icon: "shopping-bag" }
      ]
    }
  };
  const DEFAULT_BLOCK = "plan";
  let curBlock = null;
  let spy = null;
  let dayObserver = null;

  /* ---------- Hero ---------- */
  function budgetTotals() {
    const off = window._optOff || {};
    let fixed = 0, optOn = 0;
    BUDGET.forEach(c => c.items.forEach(i => {
      const s = i.st || (/可选/.test(i.name) ? "opt" : "fixed");
      const on = s === "opt" ? !off[c.cat + "|" + i.name] : true;
      if (on) { if (s === "opt") optOn += i.amount; else fixed += i.amount; }
    }));
    return { fixed, optOn, total: fixed + optOn };
  }
  /* ---------- 景点（渲染已移交 spots2.js：活攻略详情卡；车票作战板块已按需求移除） ---------- */
  function renderLinked() {
    $("#linkedGrid").innerHTML = LINKED_TICKETS.map(l => `
      <div class="linked-card">
        <b>${esc(l.name)}</b>
        <div class="price">¥${l.price}</div>
        <div class="detail">${esc(l.detail)}</div>
        <div class="tip">${esc(l.tip)}</div>
      </div>`).join("");
  }

  /* ---------- 美食（夜市卡已移交 spots2.js：带活攻略详情） ---------- */
  function renderFood() {
    $("#foodGrid").innerHTML = FOODS.map(f => `
      <div class="eat card-lift">
        <div class="eat-pic"><img src="img/food-${encodeURIComponent(f.name)}.jpg" alt="${esc(f.name)}" loading="lazy" onerror="this.parentNode.classList.add('noimg')"></div>
        <div class="eat-body">
          <div class="eat-top"><span class="food-pill">${esc(f.cat)}</span><b>${esc(f.name)}</b><span class="eat-avg">人均¥${f.avg}</span></div>
          <p class="eat-must">🔑 ${esc(f.must)}</p>
          <p class="eat-desc">${esc(f.desc)}</p>
          <div class="eat-foot">
            <small class="eat-loc">📍 ${esc(f.area)}</small>
            <span class="eat-links"><a href="${dy(f.name + " 开封 团购")}" target="_blank" rel="noopener">团购</a><a href="${xhs(f.name + " 开封")}" target="_blank" rel="noopener">攻略</a></span>
          </div>
        </div>
      </div>`).join("");
  }

  /* ---------- 演出 ---------- */
  function renderShows() {
    $("#showGrid").innerHTML = SHOWS.map(s => `
      <div class="show-card card ${s.name === "打铁花" || s.name === "王婆说媒" ? "hot" : ""}">
        <b>${esc(s.name)}</b><span class="tag">${esc(s.where)}</span>
        <p class="sub">🕐 ${esc(s.time)}</p>
        <p>${esc(s.tip)}</p>
        <a class="show-link" href="${xhs(s.name + " " + s.where + " 攻略")}" target="_blank" rel="noopener">📖 观演攻略</a>
      </div>`).join("");
    const H = window.HANFU;
    if (H && $("#hanfuBox")) {
      $("#hanfuBox").innerHTML = `
        <h3 class="sub-h">👗 汉服怎么租最省</h3>
        <div class="hanfu-grid">
          <div class="linked-card best">
            <b>${esc(H.best.name)}</b>
            <div class="price">¥${H.best.price}<small>/人</small></div>
            <div class="detail">${esc(H.best.total)}</div>
            <div class="detail">${esc(H.best.note)}</div>
            <div class="tip"><a href="${H.best.buy}" target="_blank" rel="noopener">👉 抖音搜「东风序汉服 开封」领团购</a></div>
          </div>
          <div class="linked-card">
            <b>${esc(H.free.name)}</b>
            <div class="price">¥0</div>
            <div class="detail">${esc(H.free.note)}</div>
          </div>
          <div class="linked-card">
            <b>备选小店</b>
            ${H.more.map(m => `<div class="detail">· <b>${esc(m.name)}</b> ¥${m.price} — ${esc(m.note)}</div>`).join("")}
            <div class="tip">${esc(H.tips)}</div>
          </div>
        </div>`;
    }
  }

  /* ---------- 预算（三态：已定/可选/未计 · 分类自动求和 · 可选项一键开关） ---------- */
  let optOff = {};
  function renderBudget() {
    const totals = budgetTotals();
    $("#budgetGrid").innerHTML = BUDGET.map((c, ci) => {
      const sum = c.items.filter(i => (i.st || "fixed") !== "uncounted").reduce((a, i) => {
        const s = i.st || (/可选/.test(i.name) ? "opt" : "fixed");
        if (s === "opt" && optOff[c.cat + "|" + i.name]) return a;
        return a + i.amount;
      }, 0);
      return `<div class="bud-cat" data-open="${ci}">
        <div class="bud-cat-head">${icon(c.icon)}<b>${esc(c.cat)}</b><span class="sum">¥${sum.toFixed(0)}</span></div>
        ${c.items.map(i => {
        const s = i.st || (/可选/.test(i.name) ? "opt" : "fixed");
        const key = c.cat + "|" + i.name;
        const offed = s === "opt" && optOff[key];
        const badge = s === "opt" ? `<button class="opt-toggle ${offed ? "off" : ""}" data-opt="${esc(key)}" title="一键开关可选项">${offed ? "未选" : "已选"}</button>`
          : s === "uncounted" ? `<span class="opt-badge uncounted">未计</span>` : "";
        const amt = s === "uncounted" ? `—` : `<span class="amt">¥${offed ? 0 : (i.amount % 1 ? i.amount.toFixed(2) : i.amount)}</span>`;
        return `<div class="bud-item ${offed ? "offed" : ""} ${s === "uncounted" ? "uncnt" : ""}"><span class="n">${esc(i.name)}<small>${esc(i.note)}</small></span>${badge}${amt}</div>`;
      }).join("")}
      </div>`;
    }).join("");
    const fixed = totals.fixed, opt = totals.optOn;
    $("#budTotal").innerHTML = `<span>两人合计</span><span class="big">¥${(fixed + opt).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}</span><span>人均 ¥${((fixed + opt) / 2).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}</span><span class="note">已定 ¥${fixed.toFixed(0)} + 可选（开）¥${opt.toFixed(0)} · ${esc(BUDGET_NOTE)}</span>`;

    $$("#budgetGrid [data-opt]").forEach(b => b.onclick = async () => {
      const k = b.dataset.opt;
      if (optOff[k]) delete optOff[k]; else optOff[k] = 1;
      window._optOff = optOff;
      renderBudget();
      try {
        await Store.API.j("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optOff }) });
        toast(optOff[k] ? "已移出预算（更省）" : "已计入预算");
      } catch { toast("已切换（云端未同步）", "warn"); }
    });
  }

  /* ---------- 清单 ---------- */
  function renderPack(remote) {
    const done = remote || {};
    $("#packGrid").innerHTML = PACKLIST.map((g, gi) => `
      <div class="pack-group">
        <h4>${esc(g.group)}</h4>
        ${g.items.map((it, ii) => {
          const k = `p${gi}-${ii}`;
          return `<label class="pk-item"><input type="checkbox" data-pk="${k}" ${done[k] ? "checked" : ""}><span class="box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span><span>${(window.MD ? MD.inline(esc(it)) : esc(it))}</span></label>`;
        }).join("")}
      </div>`).join("");
    const boxes = $$("[data-pk]");
    const total = boxes.length;
    function updateBar(save) {
      const n = boxes.filter(b => b.checked).length;
      $("#packBar").style.width = (n / total * 100) + "%";
      window._packStats = { done: n, all: total };   // 仪表盘「准备度」数据源
      if (save) Store.syncPlan({ days: Plan.state.plan.days, pack: packState() });
    }
    function packState() {
      const o = {};
      boxes.forEach(b => { if (b.checked) o[b.dataset.pk] = 1; });
      return o;
    }
    boxes.forEach(b => b.onchange = () => updateBar(true));
    updateBar(false);
    window._packState = packState;
  }

  /* ---------- 锦囊 ---------- */
  function renderTips() {
    $("#tipsGrid").innerHTML = TIPS.map(t => `
      <div class="tip-card">${icon(t.icon)}<h4>${esc(t.title)}</h4><p>${(window.MD ? MD.inline(esc(t.text)) : esc(t.text))}</p></div>`).join("");
  }

  /* ===============================================================
     侧栏：块内目录（二级导航，随当前块整体重绘）
     =============================================================== */
  function renderSidebar(key) {
    const box = $("#snNav");
    const B = BLOCKS[key];
    if (!box || !B) return;

    let html = `<b class="sn-cat">${esc(B.name)}</b><span class="sn-sub">${esc(B.sub)}</span>`;

    if (key === "plan") {
      html += (window.TRIP_DAYS || []).map((d, i) =>
        `<a href="#plan" data-day="${esc(d.id)}"><span class="d-num">D${i + 1}</span>${esc(d.theme)}<span class="d-meta">${esc(d.weekday || "")}</span></a>`
      ).join("") + `<a href="#journal" data-icon="camera">🎞 旅行日志</a>`;
    } else {
      html += B.items.map(it =>
        `<a href="#${it.id}" data-icon="${it.icon}">${esc(it.label)}</a>`
      ).join("");
    }
    box.innerHTML = html;

    // 补线性图标
    $$(".sn-nav a").forEach(a => {
      const k = a.dataset.icon;
      if (k && UI.icon && !a.querySelector("svg")) a.insertAdjacentHTML("afterbegin", UI.icon(k));
    });

    bindSidebar();
    initSpy();
    if (key === "plan") syncDayHighlight();
  }

  function closeNav() { document.body.classList.remove("sn-open"); }

  /* 窄屏顶栏菜单按钮 / 抽屉开关 */
  function initNav() {
    const menuBtn = $("#menuBtn"), snClose = $("#snClose"), overlay = $("#snOverlay");
    if (menuBtn) menuBtn.onclick = () => document.body.classList.add("sn-open");
    if (snClose) snClose.onclick = closeNav;
    if (overlay) overlay.onclick = closeNav;
  }

  function bindSidebar() {
    $$(".sn-nav a").forEach(a => {
      if (a._bound) return;
      a._bound = true;
      a.addEventListener("click", e => {
        e.preventDefault();
        const day = a.dataset.day;
        if (day) {
          jumpToDay(day);
        } else {
          const id = (a.getAttribute("href") || "").slice(1);
          const t = document.getElementById(id);
          if (t) { scrollToEl(t); setHash("#" + id); }
        }
        closeNav();
      });
    });
  }

  /* 行程块：D1–D6 与日切换标签双向联动 */
  function syncDayHighlight() {
    const tab = document.querySelector(".day-tab.active");
    const day = tab ? tab.dataset.day : null;
    $$(".sn-nav a[data-day]").forEach(a => a.classList.toggle("active", a.dataset.day === day));
  }
  function watchDays() {
    const tabs = $("#dayTabs");
    if (!tabs || dayObserver) return;
    dayObserver = new MutationObserver(() => syncDayHighlight());
    dayObserver.observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
  function jumpToDay(dayId) {
    const tab = document.querySelector(`.day-tab[data-day="${dayId}"]`);
    if (tab) tab.click();
    const sec = $("#plan");
    if (sec) scrollToEl(sec);
    setHash("#plan");
  }

  /* 块内滚动高亮（行程块除外，它由日标签驱动） */
  function initSpy() {
    if (spy) { spy.disconnect(); spy = null; }
    const links = $$('.sn-nav a:not([data-day])');
    if (!links.length) return;
    const targets = links
      .map(a => document.getElementById((a.getAttribute("href") || "").slice(1)))
      .filter(Boolean);
    if (!targets.length) return;
    spy = new IntersectionObserver(es => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(x => x.classList.toggle("active", x.getAttribute("href") === "#" + e.target.id));
      });
    }, { rootMargin: "-25% 0px -65% 0px" });
    targets.forEach(t => spy.observe(t));
  }

  /* ===============================================================
     切块（一级导航）
     =============================================================== */
  function goBlock(key, opts) {
    const o = Object.assign({ scroll: true, animateIn: true }, opts || {});
    if (!BLOCKS[key]) key = DEFAULT_BLOCK;
    const changed = key !== curBlock;
    curBlock = key;
    document.documentElement.dataset.cur = key;

    $$(".dock-btn").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.block === key)));

    renderSidebar(key);

    if (changed && o.animateIn) revealBlock(key);
    if (changed && o.scroll) window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });

    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  function revealBlock(key) {
    if (REDUCED || SKIP_ANIM || !window.gsap) return;
    $$(`main > [data-block="${key}"][data-reveal]`).forEach(sec => {
      gsap.from(sec.children, {
        y: 30, opacity: 0, duration: 0.55, stagger: 0.05, ease: "power3.out", clearProps: "all"
      });
    });
  }

  /* ---------- 滚动位置 / hash ---------- */
  function navOffset() { return window.innerWidth < 1080 ? 70 : 16; }
  function scrollToEl(el) {
    const top = el.getBoundingClientRect().top + window.scrollY - navOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: REDUCED ? "auto" : "smooth" });
  }
  function setHash(h) {
    try { history.pushState(null, "", h || location.pathname + location.search); } catch { /* 忽略 */ }
  }
  function blockOf(id) {
    const el = document.querySelector(`main > [data-block]#${CSS.escape(id)}`);
    return el ? el.dataset.block : null;
  }
  function handleHash(initial) {
    const id = (location.hash || "").replace(/^#/, "");
    if (!id || id === "top") {
      if (initial) goBlock(DEFAULT_BLOCK, { scroll: false });
      return;
    }
    const b = blockOf(id);
    if (!b) { if (initial) goBlock(DEFAULT_BLOCK, { scroll: false }); return; }
    if (b !== curBlock) goBlock(b, { scroll: false, animateIn: !initial });
    const t = document.getElementById(id);
    if (t) requestAnimationFrame(() => scrollToEl(t));
  }

  /* ===============================================================
     随身向导：悬浮按钮 + 浮层（跨场景工具，不占导航位）
     =============================================================== */
  function initGuide() {
    const fab = $("#guideFab"), mask = $("#guideMask"), close = $("#guideClose");
    if (!fab || !mask) return;
    const open = () => {
      mask.classList.add("show");
      mask.setAttribute("aria-hidden", "false");
      fab.setAttribute("aria-expanded", "true");
      document.body.classList.add("guide-open");
      const inp = $("#chatInput");
      if (inp) setTimeout(() => inp.focus(), 280);
    };
    const shut = () => {
      mask.classList.remove("show");
      mask.setAttribute("aria-hidden", "true");
      fab.setAttribute("aria-expanded", "false");
      document.body.classList.remove("guide-open");
    };
    fab.onclick = open;
    if (close) close.onclick = shut;
    mask.addEventListener("click", e => { if (e.target === mask) shut(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") shut(); });
    // 对外暴露，供 FAB 之外的入口调用
    window.Guide = { open, close: shut };
  }

  /* ---------- 动效 ---------- */
  function animate() {
    watchDays();
    if (REDUCED || SKIP_ANIM || !window.gsap) { UI.revealFallback(); return; }
    gsap.registerPlugin(ScrollTrigger);

    // 当前块内的区块入场：
    // 只对「视口下方」的 section 建 ScrollTrigger 渐入；
    // 首屏内的 section 绝不做 from 隐藏——避免触发器失效导致内容永远 opacity:0（首开空白根因）。
    $$(`main > [data-block="${curBlock}"][data-reveal]`).forEach(sec => {
      if (sec.getBoundingClientRect().top <= window.innerHeight * 0.9) return; // 首屏：保持可见，不动画
      gsap.from(sec.children, {
        y: 34, opacity: 0, duration: 0.7, stagger: 0.06, ease: "power3.out",
        scrollTrigger: { trigger: sec, start: "top 82%", once: true },
        clearProps: "opacity,transform"
      });
    });
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    // 导航骨架
    $$(".dock-btn").forEach(b => {
      b.addEventListener("click", () => {
        if (b.dataset.block === curBlock) { window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" }); return; }
        goBlock(b.dataset.block);
        setHash("");
      });
    });
    initNav();
    initGuide();
    window.addEventListener("hashchange", () => handleHash(false));

    // 静态渲染
    SpotCard.init();          // 景点详情卡（含夜市活攻略，异步拉设置与点评）
    renderLinked();
    renderFood();
    renderShows();
    renderBudget();
    renderTips();

    // 行程 + 清单：先拉云端，再渲染
    let remote = null;
    try { remote = await Store.API.getPlan(); Store.setOnline(true); } catch { /* 离线兜底 */ }
    await Plan.init(remote?.days ? remote : null);
    renderPack(remote?.pack);
    Expenses.init();
    Weather.init();
    MapView.init();
    Journal.init();
    Chat.init();

    // 可选项目开关状态（预算三态）云端拉取后重算
    try {
      const s = await Store.API.j("/api/settings");
      optOff = (s && s.optOff) || {}; window._optOff = optOff;
      renderBudget();
    } catch { /* 离线用默认 */ }

    // 首屏归块（含 hash 直达）
    handleHash(true);
    animate();
    window.addEventListener("load", () => { if (window.ScrollTrigger) ScrollTrigger.refresh(); });
    // 数据异步落定后布局会变，补一次 refresh（防滚动触发线漂移）
    setTimeout(() => { if (window.ScrollTrigger) ScrollTrigger.refresh(); }, 1200);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", boot)
    : boot();
})();
