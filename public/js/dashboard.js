/* 汴京秋行 2.0 · 数据仪表盘（纯 SVG，离线可用）：分类饼图 / 支出进度 / 每日曲线 / 垫付结算 / 准备度圆环 */
(function () {
  const { $, esc } = UI;
  const CAT_COLORS = { eat: "#e8833a", move: "#5a8fbf", stay: "#6b3fa0", other: "#8a8378" };
  const CAT_LABEL = { eat: "🍜 吃", move: "🚕 行", stay: "🏠 住", other: "📦 其他" };

  function arc(cx, cy, r, a0, a1) {
    const p = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
  }

  function render() {
    const box = $("#dashBoard");
    if (!box || !window.Expenses) return;
    const st = window.Expenses.stats ? window.Expenses.stats() : { sum: { A: 0, B: 0, all: 0 }, byCat: {} };

    /* 预算口径（三态求和） */
    const off = (window._optOff || {});
    let fixed = 0, optOn = 0;
    BUDGET.forEach(c => c.items.forEach(i => {
      const s = i.st || (/可选/.test(i.name) ? "opt" : "fixed");
      const on = s === "opt" ? !off[c.cat + "|" + i.name] : true;
      if (on) { if (s === "opt") optOn += i.amount; else fixed += i.amount; }
    }));
    const budget = fixed + optOn;
    const spent = st.sum.all || 0;
    const pct = Math.min(100, budget ? spent / budget * 100 : 0);

    /* 分类饼图 */
    const cats = Object.keys(CAT_COLORS).map(k => ({ k, v: st.byCat[k] || 0 })).filter(x => x.v > 0);
    const total = cats.reduce((s, x) => s + x.v, 0);
    let a0 = -Math.PI / 2;
    const pie = total ? cats.map(x => {
      const a1 = a0 + x.v / total * Math.PI * 2;
      const seg = `<path d="${arc(60, 60, 52, a0, a1 - 0.02)}" fill="${CAT_COLORS[x.k]}" opacity=".9"/>`;
      a0 = a1; return seg;
    }).join("") : `<circle cx="60" cy="60" r="52" fill="#ece3d2"/>`;

    /* 每日花费曲线（按天聚合记账 ts） */
    const byDay = {};
    (window.Expenses.raw || []).forEach(x => {
      const d = new Date(x.ts);
      const key = `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`;
      byDay[key] = (byDay[key] || 0) + x.amount;
    });
    const days = Object.keys(byDay);
    const maxV = Math.max(1, ...days.map(k => byDay[k]));
    const W = 300, H = 90;
    const path = days.length > 1
      ? "M" + days.map((k, i) => `${(i / (days.length - 1) * (W - 20) + 10).toFixed(1)},${(H - 12 - byDay[k] / maxV * (H - 26)).toFixed(1)}`).join(" L")
      : "";
    const dots = days.map((k, i) => `<circle cx="${(i / Math.max(1, days.length - 1) * (W - 20) + 10).toFixed(1)}" cy="${(H - 12 - byDay[k] / maxV * (H - 26)).toFixed(1)}" r="3.5" fill="#e8833a"><title>${k} ¥${byDay[k]}</title></circle>`).join("");

    /* 准备度（打包清单） */
    const packDone = window._packStats ? window._packStats.done : 0;
    const packAll = window._packStats ? window._packStats.all : 1;
    const ready = Math.round(packDone / packAll * 100);

    const people = window._people || ["三弦闲", "神神神"];
    const diff = st.sum.A - st.sum.B;
    const settle = !spent ? "记第一笔，结算自动算"
      : Math.abs(diff) < 0.01 ? "垫付持平 🎉"
      : diff > 0 ? `${esc(people[1])} 欠 ${esc(people[0])} ¥${(diff / 2).toFixed(0)}`
      : `${esc(people[0])} 欠 ${esc(people[1])} ¥${(-diff / 2).toFixed(0)}`;

    box.innerHTML = `
      <div class="dash-card">
        <h4>🥧 支出分类</h4>
        <div class="dash-flex">
          <svg viewBox="0 0 120 120" class="dash-pie">${pie}</svg>
          <div class="dash-legend">${cats.length ? cats.map(x => `<span><i style="background:${CAT_COLORS[x.k]}"></i>${CAT_LABEL[x.k]} ¥${x.v.toFixed(0)}</span>`).join("") : "<span class='gd-empty'>还没记账</span>"}</div>
        </div>
      </div>
      <div class="dash-card">
        <h4>📊 预算 vs 实际</h4>
        <div class="dash-big">¥${spent.toFixed(0)} <small>/ 预算 ¥${budget.toFixed(0)}</small></div>
        <div class="dash-bar"><i style="width:${pct.toFixed(1)}%" class="${pct > 90 ? "hot" : ""}"></i></div>
        <p class="dash-sub">已定 ¥${fixed.toFixed(0)} + 可选（开） ¥${optOn.toFixed(0)} · 花了预算的 <b>${pct.toFixed(0)}%</b></p>
      </div>
      <div class="dash-card">
        <h4>📈 每日花费曲线</h4>
        <svg viewBox="0 0 ${W} ${H}" class="dash-line" preserveAspectRatio="none">
          ${days.length > 1 ? `<path d="${path}" fill="none" stroke="#e8833a" stroke-width="2.5" stroke-linecap="round"/>${dots}` : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#b9b0a0">记账两天后出现曲线</text>`}
        </svg>
      </div>
      <div class="dash-card">
        <h4>💰 垫付结算</h4>
        <div class="dash-big">${settle}</div>
        <p class="dash-sub">${esc(people[0])} 垫 ¥${(st.sum.A || 0).toFixed(0)} · ${esc(people[1])} 垫 ¥${(st.sum.B || 0).toFixed(0)}</p>
        <h4 style="margin-top:14px">🎒 行前准备度</h4>
        <div class="dash-ring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" fill="none" stroke="var(--border)" stroke-width="4"/><circle cx="22" cy="22" r="19" fill="none" stroke="var(--orange)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(ready / 100 * 119.4).toFixed(1)} 119.4" transform="rotate(-90 22 22)"/></svg><b>${ready}%</b></div>
        <p class="dash-sub">打包清单 ${packDone}/${packAll} 项</p>
      </div>`;
  }

  function init() {
    if (!$("#dashBoard")) return;
    render();
    setInterval(render, 15000);   // 记账变动后自动刷新（轻量轮询兜底）
    window.Dashboard = { refresh: render };
  }
  window.Dashboard = { init, refresh: render };
})();
