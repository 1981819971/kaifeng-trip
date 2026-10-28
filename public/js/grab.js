/* 汴京秋行 2.0 · 抢票作战室（倒计时 + 任务时间线 + Server酱提醒） */
(function () {
  const { $, $$, esc, toast } = UI;
  const fmt2 = n => String(n).padStart(2, "0");

  /* 三条抢票战线：来自 TRANSPORT 数据（口径一致） */
  function missions() {
    const T = window.TRANSPORT;
    return [
      { key: "goA", who: "三弦闲", what: "K332 天津→开封 ✅已兑现", iso: "2026-09-16T13:30:00+08:00", open: T.goFirt.open, buy: T.goFirt.buy, tc: T.goFirt.tc, planB: T.goFirt.planB },
      { key: "goB", who: "神神神", what: "K1064 重庆北→郑州 ✅已兑现", iso: "2026-09-16T11:00:00+08:00", open: T.goFriend.open, buy: T.goFriend.buy, tc: T.goFriend.tc, planB: T.goFriend.planB }
    ];
  }

  /* 任务时间线（checkbox 状态存服务器）——预约与购票作战表 */
  const TASKS = [
    { id: "t1", due: "✅ 已完成", title: "四张大交通全部兑现", desc: "K332（天津→开封 10.1 06:27）、K1064（重庆北→郑州 10.1 18:14）、K330（开封→天津 10.6 20:02）、T9（郑州→重庆西 10.6 22:13）。", done: true },
    { id: "t2", due: "✅ 已完成", title: "清园童趣年卡 + 半糖妆造券", desc: "清园年卡 ¥61.88/人（366 天随便玩，刷身份证入园）；半糖妆造团购 ¥93.9（两套任选，免预约随时退）。", done: true },
    { id: "t4", due: "9.25 起可订", title: "万岁山 10.2 半价票 ×2", desc: "十一单日不限次 学生 ¥50（赠翰园碑林+开封城墙+铁塔，自首入园 3 日内有效，凭身份证入园免取票）。10.2 首入园即激活赠票，D4 收官日靠它免费玩。", done: false },
    { id: "t5", due: "10.1 入住时", title: "民宿双人电动车交接", desc: "免费双人电动车：当场试骑确认电量/刹车/车灯，问清充电位置、要两个头盔，拍下已有划痕；夜骑必开灯、戴头盔。", done: false },
    { id: "t6", due: "提前 1-3 天", title: "开封博物馆预约 + 返程网约车", desc: "博物馆免费但要在「开封市博物馆」公众号预约（10.6 是周二正常开馆）；10.6 傍晚预约民宿→开封站网约车（K330 20:02 发车，18:30 前出发，电动车驮不了行李箱）。", done: false },
    { id: "t7", due: "10.2 当天 14:30", title: "小程序预约打铁花 19:30 场", desc: "入园后小程序定位预约，定好闹钟提前 1 分钟进，手慢秒没；单人建议支付宝抢（信息导入快）。没有抢到就等 21:30 加场。", done: false }
  ];

  let grab = { tasks: {}, notified: {} };
  let settings = { people: ["三弦闲", "神神神"], hasKey: false };
  let timer = null;

  async function load() {
    try { grab = Object.assign(grab, await Store.API.j("/api/grab")); } catch { }
    try { settings = Object.assign(settings, await Store.API.j("/api/settings")); } catch { }
  }
  function save() { Store.API.j("/api/grab", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(grab) }).catch(() => { }); }

  function countdown(iso) {
    const diff = new Date(iso) - Date.now();
    if (diff <= 0) return { gone: true, text: "已开抢" };
    const d = Math.floor(diff / 86400000), h = Math.floor(diff / 3600000) % 24,
      m = Math.floor(diff / 60000) % 60, s = Math.floor(diff / 1000) % 60;
    const urgent = diff < 3600000;
    return { gone: false, urgent, text: d > 0 ? `${d} 天 ${fmt2(h)}:${fmt2(m)}:${fmt2(s)}` : `${fmt2(h)}:${fmt2(m)}:${fmt2(s)}` };
  }

  function render() {
    const box = $("#grabGrid");
    if (!box) return;
    box.innerHTML = missions().map(m => {
      const c = countdown(m.iso);
      return `<div class="grab-mission card ${c.gone ? "gone" : c.urgent ? "urgent" : ""}">
        <div class="grab-head"><span class="grab-who">${esc(m.who)}</span><b>${esc(m.what)}</b></div>
        <div class="grab-cd ${c.gone ? "" : c.urgent ? "hot" : ""}" data-cd="${m.key}">${c.gone ? "🚀 " + esc(m.open) + " · 已开抢" : "⏳ " + c.text}</div>
        <div class="grab-open">${esc(m.open)}</div>
        <div class="grab-bar"><i style="width:${barPct(m.iso)}%"></i></div>
        <div class="trans-links">
          <a class="btn sky sm" href="${m.buy}" target="_blank" rel="noopener">12306 购票</a>
          <a class="btn ghost sm" href="${m.tc}" target="_blank" rel="noopener">同程比价</a>
        </div>
        <div class="grab-planb"><b>Plan B</b><p>${esc(m.planB)}</p></div>
      </div>`;
    }).join("");

    /* 任务时间线 */
    const tl = $("#grabTasks");
    tl.innerHTML = TASKS.map(t => {
      const done = grab.tasks[t.id] ?? t.done;
      return `<label class="grab-task ${done ? "done" : ""}">
        <input type="checkbox" data-gt="${t.id}" ${done ? "checked" : ""}>
        <span class="gt-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
        <span class="gt-body"><span class="gt-due">${esc(t.due)}</span><b>${esc(t.title)}</b><p>${esc(t.desc)}</p></span>
      </label>`;
    }).join("");
    $$("[data-gt]").forEach(cb => cb.onchange = () => {
      grab.tasks[cb.dataset.gt] = cb.checked;
      cb.closest(".grab-task").classList.toggle("done", cb.checked);
      save();
      renderProgress();
      if (cb.checked) toast("作战任务完成 ✓");
    });
    renderProgress();
    renderPush();
  }

  function barPct(iso) {
    const total = 3 * 86400000; // 三天倒计条
    const diff = new Date(iso) - Date.now();
    return Math.max(0, Math.min(100, (1 - diff / total) * 100));
  }
  function renderProgress() {
    const done = TASKS.filter(t => (grab.tasks[t.id] ?? t.done)).length;
    const el = $("#grabProg");
    if (el) el.innerHTML = `<b>${done}/${TASKS.length}</b> 项就绪 · 完成全部才算「可以开抢」`;
  }

  /* Server酱 */
  function renderPush() {
    const box = $("#grabPush");
    if (!box) return;
    box.innerHTML = `
      <div class="push-row">
        <input id="scKey" type="text" placeholder="Server酱 SendKey（sct.ftqq.com 免费申请，推到微信）" value="">
        <button class="btn sky sm" id="scSave">保存</button>
        <button class="btn ghost sm" id="scTest">测试推送</button>
      </div>
      <p class="push-note">${settings.hasKey ? "✅ SendKey 已配置：开抢前 24h/1h/10min（页面开着时）自动提醒，另含每日早安天气摘要。" : "⚠️ 还没配 SendKey——填好后点「测试推送」，微信收到才算通。"}</p>`;
    $("#scSave").onclick = async () => {
      const v = $("#scKey").value.trim();
      const r = await Store.API.j("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serverchan: v }) }).catch(() => null);
      if (r) { settings.hasKey = !!v; toast(v ? "SendKey 已保存 ✓" : "已清空 SendKey"); renderPush(); }
      else toast("保存失败", "warn");
    };
    $("#scTest").onclick = async () => {
      const r = await Store.API.j("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "汴京秋行 · 测试", desp: "这是一条测试推送。收到它说明开抢提醒链路已通，9.16 见真章。🚄" }) }).catch(e => ({ error: e.message }));
      if (r.error) toast("推送失败：" + r.error, "warn");
      else toast("已推送，看微信 ✓");
    };
  }

  /* 阈值提醒（页面开着时生效）+ 每日早安摘要 */
  const THRESHOLDS = [[24 * 3600e3, "24小时"], [3600e3, "1小时"], [600e3, "10分钟"]];
  function tick() {
    $$(".grab-mission").forEach(card => {
      const key = card.querySelector("[data-cd]").dataset.cd;
      const m = missions().find(x => x.key === key);
      const c = countdown(m.iso);
      const el = card.querySelector("[data-cd]");
      el.textContent = c.gone ? "🚀 已开抢" : "⏳ " + c.text;
      el.classList.toggle("hot", !c.gone && c.urgent);
      card.classList.toggle("urgent", !c.gone && c.urgent);
      card.classList.toggle("gone", c.gone);
      if (!c.gone) THRESHOLDS.forEach(([ms, label]) => {
        const k = m.key + label;
        if (Math.abs((new Date(m.iso) - Date.now()) - ms) < 1500 && !grab.notified[k]) {
          grab.notified[k] = Date.now(); save();
          Store.API.j("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `距开抢只剩${label}`, desp: `**${m.who} · ${m.what}**\n\n${m.open}\n\n双端就位，只留一个动作！` }) }).catch(() => { });
          toast(`⏰ 距 ${m.who} 开抢只剩${label}！`, "warn");
        }
      });
    });
  }
  async function morningPush() {
    if (!settings.hasKey) return;
    const today = new Date().toISOString().slice(0, 10);
    if (grab.notified["morning" + today]) return;
    grab.notified["morning" + today] = Date.now(); save();
    try {
      const w = await Store.API.j("/api/weather").catch(() => null);
      const kf = w && w.days ? w.days.find(d => d.date === today) : null;
      const next = missions().map(m => ({ m, c: countdown(m.iso) })).filter(x => !x.c.gone).sort((a, b) => new Date(a.m.iso) - new Date(b.m.iso))[0];
      const depMs = new Date("2026-09-30T19:42:00+08:00") - Date.now();
      const depD = Math.floor(depMs / 86400000), depH = Math.floor(depMs / 3600000) % 24;
      const depLabel = depD > 0 ? `${depD} 天 ${depH} 小时` : `${Math.max(1, Math.floor(depMs / 3600000))} 小时`;
      const desp = [`早安！距发车（9.30 晚 K332）还有 **${depLabel}**。`,
        next ? `最近一战：${next.m.who} ${next.m.what}，**${next.c.text}** 后开抢。` : "车票阶段已收官。",
        kf ? `开封今日 ${kf.tmin}~${kf.tmax}℃，降水概率 ${kf.pop}%。` : "开封预报暂未出（16 天窗口外）。"].join("\n\n");
      Store.API.j("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "汴京秋行 · 早安作战简报", desp }) }).catch(() => { });
    } catch { }
  }

  async function init() {
    if (!$("#grabGrid")) return;
    await load();
    render();
    tick();
    timer = setInterval(tick, 1000);
    morningPush();
  }
  window.Grab = { init };
})();
