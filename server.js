/* 汴京秋行 2.0 · 服务端（零依赖 Node HTTP）
 * - 静态托管 public/ + REST + 上传文件(/files)
 * - 三层职责：数据层(事实数据，本文件维护) / 算法层(骨架引擎·硬规则) / 表达层(LLM 只润色与翻译意图)
 * - AI：方舟五模型链式降级；天气：30 分钟缓存；数据：data/db.json 原子写 */
"use strict";
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PUB = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const UPLOADS = path.join(DATA_DIR, "uploads");
const DB = path.join(DATA_DIR, "db.json");

const MAX_HIST = 60;
const MAX_BODY = 14 * 1024 * 1024;
const WEATHER_TTL = 30 * 60 * 1000;

/* ---------------- 数据层 ---------------- */
const DEFAULTS = {
  plan: { days: {}, pack: {} },
  expenses: [], chat: [], reviews: [], journal: [],
  grab: { tasks: {}, notified: {} },
  settings: { people: ["三弦闲", "神神神"], serverchan: "", optOff: {} }
};
let db = JSON.parse(JSON.stringify(DEFAULTS));

function loadDB() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB, "utf8"));
    for (const k of Object.keys(DEFAULTS)) {
      if (raw[k] === undefined) continue;
      db[k] = (k === "plan" || k === "grab" || k === "settings") ? Object.assign({}, DEFAULTS[k], raw[k]) : raw[k];
    }
  } catch { /* 首次运行 */ }
}
function saveDB() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB);
}
function loadFrontData() {
  try {
    const read = f => fs.readFileSync(path.join(PUB, "js", f), "utf8");
    const wrap = code => new Function("window", code + "; return window;")({});
    const w1 = wrap(read("data-days.js")), w2 = wrap(read("data-content.js")), w3 = wrap(read("data-extra.js"));
    return { days: w1.TRIP_DAYS, transport: w2.TRANSPORT, spots: w2.SPOTS, linked: w2.LINKED_TICKETS, foods: w2.FOODS, shows: w2.SHOWS, markets: w2.NIGHT_MARKETS, budget: w3.BUDGET, tips: w3.TIPS };
  } catch { return null; }
}

/* ---------------- 数据层 · 天气（30 分钟缓存 · 开封单城） ---------------- */
const KF = { lat: 34.7972, lon: 114.3075 };
function fetchWeather(pos) {
  return new Promise((resolve, reject) => {
    const q = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=Asia%2FShanghai&forecast_days=16`;
    const u = new URL(q);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "GET", timeout: 12000 }, res => {
      let buf = ""; res.on("data", c => (buf += c));
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) return reject(new Error("weather HTTP " + res.statusCode));
          const d = JSON.parse(buf).daily || {};
          const days = (d.time || []).map((t, i) => ({ date: t, tmax: Math.round(d.temperature_2m_max?.[i]), tmin: Math.round(d.temperature_2m_min?.[i]), pop: d.precipitation_probability_max?.[i] ?? 0, code: d.weather_code?.[i] ?? 0 }));
          resolve({ fetchedAt: Date.now(), days });
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("weather timeout")));
    req.end();
  });
}
async function getWeather(force) {
  const c = db.weatherCache;
  if (!force && c && Date.now() - c.fetchedAt < WEATHER_TTL && c.days) return { ...c, fresh: true };
  // 顺序拉取 + 单次重试（并发易被限流），任一成功即入库
  async function grab(pos) {
    try { return await fetchWeather(pos); } catch { try { await new Promise(r => setTimeout(r, 1200)); return await fetchWeather(pos); } catch { return null; } }
  }
  const kf = await grab(KF);
  const w = { fetchedAt: Date.now(), days: kf ? kf.days : (c && c.days) || [] };
  if (kf) { db.weatherCache = w; saveDB(); return { ...w, fresh: true }; }
  return c && c.days ? { ...c, fresh: false, stale: true } : { fetchedAt: 0, days: [], error: "weather fetch failed" };
}
const TRIP_ISO = { "10.01": "2026-10-01", "10.02": "2026-10-02", "10.03": "2026-10-03", "10.04": "2026-10-04", "10.05": "2026-10-05", "10.06": "2026-10-06" };
function weatherTrip() {
  const c = db.weatherCache;
  const days = Object.entries(TRIP_ISO).map(([d, t]) =>
    (c && (c.days || []).find(x => x.date === t)) || { date: t, none: "预报未出（超出 16 天窗口）" }
  );
  return { fetchedAt: c ? c.fetchedAt : 0, days };
}
function popOf(date) {
  const c = db.weatherCache, iso = TRIP_ISO[date];
  if (!c || !iso) return 0;
  const d = (c.days || []).find(x => x.date === iso);
  return d ? d.pop : 0;
}

/* ---------------- 算法层 · 行程骨架引擎（硬规则，LLM 不得绕过） ---------------- */
const AREAS = {
  longting: { name: "龙亭片区", spots: ["万岁山", "清明上河园", "龙亭", "天波杨府", "翰园", "铁塔", "东赵屯", "城墙", "大梁门"] },
  oldtown: { name: "老城片区", spots: ["大相国寺", "开封府", "山陕甘会馆", "州桥", "书店街", "鼓楼", "西司", "包公湖", "双龙巷", "第一楼", "邢家锅贴"] },
  campus: { name: "东郊片区", spots: ["老河大", "博物馆", "河南大学", "河大"] }
};
const NIGHT_SHOWS = [{ key: "打铁花", time: 19 * 60 + 30 }, { key: "大宋·东京梦华", time: 20 * 60 + 10 }];
const STAMINA = { d1: 9000, d2: 26000, d3: 24000, d4: 14000, d5: 20000, d6: 9000 };
const toMin = t => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };

function skeletonFor(dayId, opt) {
  const data = loadFrontData();
  const d = data && (data.days || []).find(x => x.id === dayId);
  if (!d) return null;
  const o = opt || {};
  const notes = [];
  const items = d.items.map(x => ({ ...x }));

  /* 规则1 · 雨天：降水>60% 且含万岁山（现只在 D2）→ 与 D3/D5 清园年卡日对调 + 启用开封博物馆 */
  const pop = o.pop ?? popOf(d.date);
  const hasWSS = items.some(i => /万岁山/.test(i.title));
  if (pop >= 60 && hasWSS && dayId === "d2") {
    const alt = data.days.find(x => x.id === "d3" || x.id === "d5");
    if (alt) { notes.push(`降水概率 ${pop}%≥60%：触发雨天规则——万岁山（户外剧遇雨取消）与 D3/D5 清园年卡日对调（年卡刷证随时进、改期零成本），室内备选启用开封博物馆（免费需公众号预约，周一闭馆——10.5 逢周一，对调时优先换 D5、次选 D3）。注意：万岁山赠票（翰园/城墙/铁塔）的 3 日窗口跟着「首次入园日」走，对调后需重新计算（对 D5 对调无影响，赠票仍在 D4 前有效）。`); }
  } else if (pop >= 60 && hasWSS) {
    notes.push(`降水概率 ${pop}%：万岁山户外演出（打铁花/马战/水幕秀）遇雨临时取消风险高，以园区广播为准；室内备选开封博物馆（免费，需公众号预约，周一闭馆）。`);
  }

  /* 规则2 · 演出锚定：夜场演出当天傍晚必须留给该园区 */
  const anchor = items.find(i => /打铁花|东京梦华/.test(i.title));
  if (anchor) {
    const t = toMin(anchor.time);
    const show = NIGHT_SHOWS.find(s => anchor.title.includes(s.key));
    if (show && t !== null && t < show.time - 90) {
      notes.push(`演出锚定：${anchor.title} 在 ${anchor.time}，${show.key} 约 ${Math.floor(show.time / 60)} 点半前后，需提前 60–90 分钟占位（研究情报：14:30 小程序可预约 19:30 打铁花前排）。`);
    }
  }

  /* 规则3 · 体力预算：暴走日当晚不排夜市 */
  const heavy = items.filter(i => /万岁山|清明上河园/.test(i.title)).length >= 2;
  if (heavy) {
    const nm = items.filter(i => /夜市/.test(i.title + (i.desc || "")));
    if (nm.length) notes.push(`体力预算：暴走日（步数预算约 ${(STAMINA[dayId] || 18000).toLocaleString()} 步），当晚夜市建议顺延次日或改民宿周边简餐。`);
  }

  /* 规则4 · 片区聚类：跨片区折返提醒 */
  const areaHit = new Set();
  items.forEach(i => { for (const k of Object.keys(AREAS)) if (AREAS[k].spots.some(s => (i.title + (i.desc || "")).includes(s))) areaHit.add(k); });
  if (areaHit.size >= 3) notes.push(`片区聚类：本日跨 ${areaHit.size} 个片区（${[...areaHit].map(k => AREAS[k].name).join("、")}），折返成本高，建议共享电动车串联或删减 1 个远端点位。`);

  return { day: dayId, date: d.date, theme: d.theme, pop, stepsBudget: STAMINA[dayId] || 18000, items, notes };
}

/* ---------------- 预算口径（分类自动求和 · 三态） ---------------- */
function budgetSummary() {
  const data = loadFrontData();
  if (!data) return null;
  const off = db.settings.optOff || {};
  const optional = [];
  let fixed = 0, optOn = 0;
  data.budget.forEach(c => c.items.forEach(i => {
    const st = i.st || (/可选/.test(i.name) ? "opt" : "fixed");
    const key = c.cat + "|" + i.name;
    const on = st === "opt" ? !off[key] : true;
    if (st === "opt") optional.push({ key, name: i.name, amount: i.amount, on });
    if (on) { if (st === "opt") optOn += i.amount; else fixed += i.amount; }
  }));
  const spent = db.expenses.reduce((s, x) => s + (+x.amount || 0), 0);
  const total = fixed + optOn;
  return { fixedTotal: Math.round(fixed), optionalTotal: Math.round(optOn), grandTotal: Math.round(total), perPerson: Math.round(total / 2), optional, actualSpent: Math.round(spent), people: db.settings.people };
}

/* ---------------- 表达层 · 系统提示词 ---------------- */
/* 北京时间（手写 +8 弃用 toLocaleString——部署沙箱 ICU/时区数据不可靠，
   曾把 10.1 早 7 点报成「9 月 30 日 23 点」喂给模型） */
function beijingNow() {
  const d = new Date(Date.now() + 8 * 3600e3), p = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 星期${"日一二三四五六"[d.getUTCDay()]} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function buildSystemPrompt() {
  const data = loadFrontData();
  let trip = "（行程数据加载失败，请提示用户查看页面区块）";
  if (data) trip = JSON.stringify(data);
  const sk = {};
  if (data) data.days.forEach(d => { sk[d.id] = skeletonFor(d.id); });
  const bud = budgetSummary() || {};
  const expLines = db.expenses.slice(-12).map(x => `${x.name} ¥${x.amount}(${db.settings.people[x.payer === "B" ? 1 : 0] || "朋友"}垫付)`);
  return [
    "你是「汴京小向导」，开封国庆六日游的随身 AI 向导。用户是两位大学生：" + db.settings.people.map((p, i) => `${p}（${["天津", "重庆"][i]}出发）`).join("和") + "。",
    "现在是北京时间 " + beijingNow() + "（本条由服务器时钟直出，绝对可信）。凡涉及「今天/明天/还剩几天/几点了」的计算，一律以这条时间为准，不要从其他数据里推断日期。",
    "",
    "【三层职责 · 必须遵守】",
    "1. 数据层（服务器维护，你只读不可改）：行程/车次/景点票价/演出时刻/天气/已确认票务/餐馆，见资料。",
    "2. 算法层（服务器已用硬规则算好每日「行程骨架」SKELL）：片区聚类、演出时间锚定（19:30 打铁花→万岁山必须排傍晚）、体力预算（单日步数上限、暴走日不排夜市）、雨天规则（降水>60% 时万岁山 D2 与 D3/D5 清园年卡日对调并启用开封博物馆）。你不得脱离骨架自行编造行程。",
    "3. 表达层（你的工作）：a) 把用户自然语言意图（如「10.3 下雨怎么改」「我们想多睡一小时」）翻译成对骨架的调整指令，按补丁协议输出；b) 把骨架润色成有语气、有提醒的攻略文本。",
    "",
    "【实时状态】",
    "省钱版口径（2026-09-23 v7 · 老君山已取消，不得再推荐，K419/K558 已退票）：**D1 是抵达安顿日：上午补觉，14:00-16:00 菲尔特锁死网课家教（不可挪动，行程必须让路），傍晚大相国寺（学生 ¥19，17:30 停止入场）+ 夜里接神神神，不排万岁山、不打铁花**；**D2 直奔万岁山**（07:00 起，07:20 骑电动车出发，08:10 开园第一波进园，**早餐在园内解决**，进门先小程序预约《三打祝家庄》和《打铁花》两场）；**D3 清园汉服日不出园 + D5 清园二刷**（童趣年卡已购 ¥61.88/人，刷 D3+D5）；**D4 免费寻宝日**：州桥遗址（2024 起免费开放）→ 河南大学明伦校区（周日 9:00-17:00 免费登记参观，10.4 恰周日）→ 老河大西门学生街 → 铁塔 → 翰园碑林 → 大梁门城墙 → 西司夜市；翰园碑林/铁塔/开封城墙凭 10.2 万岁山票赠（自首入园 3 日内有效 → 只能 D2-D4 用，D4 收官）；开封博物馆（免费、需「开封市博物馆」公众号预约、周一闭馆）排在 10.6；御河夜游(¥120)已取消（包公湖沿岸免费夜景替代）；**市内交通全程骑民宿免费双人电动车，基本不打车（仅车站接送）**；餐饮 ¥70/人/天。",
    "天气（开封单城预报，服务器每 30 分钟刷新，超出 16 天窗口的日期无预报）：" + JSON.stringify(weatherTrip()) + " 数据源说明：Open-Meteo 国际模式（开封市区坐标），与手机自带天气（中国气象局源）存在口径差异——pop 是全天降水概率（≥60% 才当雨天处理），不是『会下雨』；温度可能与手机差 1-2℃、现象差一档（我们报毛毛雨/手机报阴都正常）。用户问『为什么和手机不一样』时照此解释，并提醒：出行决策看趋势（我们的雨天规则已内置），临出发以中国天气网/手机为准。",
    "预算口径（分类自动求和，可选项目见 optional[].on，引用数字只能用这些字段）：" + JSON.stringify(bud),
    "记账近况：" + (expLines.length ? expLines.join("；") : "还没记一笔"),
    "",
    "【每日行程骨架 SKELL（算法层产出，notes 为规则说明）】",
    JSON.stringify(sk),
    "",
    "【完整资料】\n" + trip,
    "",
    "【回答规则】",
    "1. 中文，简明口语化；重点用 **加粗**，默认不超过 300 字。",
    "2. 行程调整类请求：先一两句说明改了什么，再追加补丁 [[PLAN_PATCH]]{\"days\":{\"dX\":{\"items\":[{\"time\":\"HH:MM\",\"title\":\"标题\",\"desc\":\"一句话\",\"tags\":[\"分类\"]}]}}}[[/PLAN_PATCH]]（整组替换该天，含未改动时段，24 小时制）。只是聊想法时禁止输出补丁。",
    "3. 余票/当日场次/临时闭园，提醒以 12306、景区官方小程序当日公告为准。",
    "4. 用户问攻略没覆盖的新景点/新店，可给建议但注明「未在计划内，需自行核实」。",
    "5. 引用预算只能用【实时状态】字段口径，不得自行加总或沿用旧数字。"
  ].join("\n");
}

/* ---------------- AI · 模型链式（豆包平台 Coding Plan 单 key · 文字/带图同池） ---------------- */
const ARK_KEY2 = process.env.ARK_KEY2 || ""; // 必须由环境变量注入，仓库内不保存密钥
// Coding Plan 专用端点（OpenAI 兼容协议）。⚠️ 官方口径该额度仅供 AI 编程工具使用，普通 API 调用属违规——
// 2026-09-23 菲尔特知情后明确拍板「不管官方，直接接」，风险自担；若日后被限/封，换回普通方舟计费即可。
const ARK_CODING_URL = "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions";
// 链顺序（2026-09-23 直连实测，小请求）：ds-v4.1-flash 1.2s / 2.0-mini 0.7s / 2.1-lite 2.0s / kimi 2.0s / 2.1-pro 2.9s / glm-5.3-flash 5.8s。
// 文字链：最快的 deepseek-v4.1-flash 首发，6s 没回对冲 2.1-pro（确认多模态，兜得住大上下文）；mini/kimi/glm 顺次兜底。
const CHAIN_TEXT = ["deepseek-v4.1-flash", "doubao-seed-2.1-pro", "doubao-seed-2.0-mini", "kimi-k2.8-preview", "glm-5.3-flash"];
// 带图链：只留确认支持视觉的（2.1-pro / 2.1-lite 官方标注多模态；glm-5.3-flash 实测支持）。
const CHAIN_VISION = ["doubao-seed-2.1-pro", "doubao-seed-2.1-lite", "glm-5.3-flash", "deepseek-v4.1-flash"];
// 把消息里的 base64 图替换为占位文本（存库 / 发给模型的历史都用瘦身版，只有最后一条用户消息保留原图）
function slimMsg(m) {
  if (typeof m.content === "string") return m;
  const parts = (m.content || []).filter(c => c.type === "text" || c.type === "image_url");
  const texts = parts.filter(c => c.type === "text").map(c => c.text);
  if (parts.some(c => c.type === "image_url")) texts.push("[图片]");
  return { role: m.role, content: texts.join(" ") };
}
function codingChatOnce(model, messages, maxTokens, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens || 2200 });
    const u = new URL(ARK_CODING_URL);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ARK_KEY2, "Content-Length": Buffer.byteLength(body) },
      timeout: timeoutMs || 28000
    }, res => {
      let buf = ""; res.on("data", c => (buf += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(buf);
          if (res.statusCode !== 200) return reject(new Error(`${model}: ${j.error?.message || "HTTP " + res.statusCode}`));
          const c = j.choices?.[0]?.message?.content;
          if (!c) return reject(new Error(model + ": 空回复"));
          resolve(c);
        } catch { reject(new Error(model + ": 响应解析失败")); }
      });
    });
    req.on("error", e => reject(new Error(model + ": " + e.message)));
    req.on("timeout", () => req.destroy(new Error(model + ": 请求超时")));
    req.write(body); req.end();
  });
}
async function arkChain(messages) {
  // 带图检测：末条用户消息含 image_url → 走视觉链（只有视觉模型，避免纯文本模型挂起/烧预算）
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  const hasImage = lastUser && Array.isArray(lastUser.content) && lastUser.content.some(c => c.type === "image_url");
  const chain = hasImage ? CHAIN_VISION : CHAIN_TEXT;
  if (hasImage) console.log("[ARK] 带图请求 → 视觉链:", chain.join(" → "));
  const tried = [];
  const pretty = m => "doubao/" + m;

  const tryModel = (m, timeoutMs) => codingChatOnce(m, messages, null, timeoutMs);

  // 对冲窗口：首模型 7s 没回 → 备模型并发开跑，先答先得（解决智谱偶发挂起拖满 28s 的问题）
  function hedge(m1, m2, delayMs, t1, t2) {
    return new Promise((resolve, reject) => {
      let settled = false, secStarted = false;
      const errs = [];
      const startSec = () => {
        if (secStarted || settled) return;
        secStarted = true;
        tryModel(m2, t2).then(
          r => { if (!settled) { settled = true; resolve({ reply: r, model: m2 }); } },
          e => { errs.push(`${m2}: ${e.message}`); if (errs.length >= 2 && !settled) reject(errs); }
        );
      };
      const timer = setTimeout(startSec, delayMs);
      tryModel(m1, t1).then(
        r => { if (!settled) { settled = true; clearTimeout(timer); resolve({ reply: r, model: m1 }); } },
        e => { errs.push(`${m1}: ${e.message}`); clearTimeout(timer); startSec(); if (secStarted && errs.length >= 2 && !settled) reject(errs); }
      );
    });
  }

  const deadline = Date.now() + 35000; // 总预算 35s：实测网关可容忍 48s，留足余量绝不 502/504
  // 第一二跳对冲（首发 12s 上限、6s 没回备胎并发；备跳 16s）
  if (chain.length >= 2 && Date.now() <= deadline) {
    try {
      const h = await hedge(chain[0], chain[1], 6000, 12000, 16000);
      if (h.model !== chain[0]) console.log(`[ARK] 对冲接管：${chain[0]} 6s 未回/失败 → ${h.model} 先答`);
      return { reply: h.reply, model: pretty(h.model), tried };
    } catch (e) {
      const list = Array.isArray(e) ? e : [e.message || String(e)];
      list.forEach(x => tried.push(x));
      console.log("[ARK] 对冲两跳全失败 → 继续顺序降级:", list.join(" | "));
    }
  }
  // 剩余模型顺序降级
  for (let i = 2; i < chain.length; i++) {
    const m = chain[i];
    if (Date.now() > deadline) {
      console.log(`[ARK] 预算耗尽，停止降级（已试 ${i}/${chain.length}）：`, tried.join(" | "));
      break;
    }
    try {
      const reply = await tryModel(m, 18000);
      if (tried.length) console.log(`[ARK] 降级成功：${chain[i - tried.length - 1] || "(首模型)"} 失败后由 ${m} 接管`);
      return { reply, model: pretty(m), tried };
    } catch (e) {
      tried.push(e.message);
      console.log(`[ARK] ${m} 不可用 → 降级：${e.message}${i + 1 < chain.length ? " → 下一个 " + chain[i + 1] : ""}`);
      // 图片数据本身损坏时降级毫无意义（下一家也收不到好图），立即终止省掉 10s+ 空烧
      if (hasImage && /Invalid base64|not valid/i.test(e.message)) {
        throw new Error("图片数据损坏，请把图删掉重新选一张再发");
      }
    }
  }
  throw new Error("全部模型不可用：" + tried.join(" | "));
}

/* ---------------- Server 酱 ---------------- */
function serverchanSend(desp, title) {
  const key = db.settings.serverchan;
  if (!key) return Promise.reject(new Error("未配置 Server酱 SendKey"));
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ title: title || "汴京秋行提醒", desp }).toString();
    const req = https.request({
      hostname: "sctapi.ftqq.com", path: `/${encodeURIComponent(key)}.send`, method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
      timeout: 10000
    }, res => {
      let buf = ""; res.on("data", c => (buf += c));
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve({ raw: buf.slice(0, 200) }); } });
    });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("推送超时")));
    req.write(body); req.end();
  });
}

/* ---------------- HTTP 工具 ---------------- */
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve({}); } });
    req.on("error", reject);
  });
}
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".woff2": "font/woff2" };
function serveFile(res, file, cache) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404 Not Found"); }
    res.writeHead(200, { "Content-Type": (MIME[path.extname(file).toLowerCase()] || "application/octet-stream") + "; charset=utf-8", "Cache-Control": cache || "no-cache" });
    res.end(buf);
  });
}
function serveStatic(req, res, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath); } catch { res.writeHead(400); return res.end("Bad Request"); }
  p = p.split("?")[0];
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end("Forbidden"); }
  serveFile(res, file);
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    /* ---- 计划（含 grab 任务 / 可选项开关 / 自定义日程） ---- */
    if (p === "/api/plan") {
      if (req.method === "GET") return json(res, 200, db.plan);
      if (req.method === "PUT") {
        const b = await readBody(req);
        if (b && typeof b === "object") {
          db.plan = {
            days: b.days || {}, pack: b.pack || {},
            custom: b.custom && typeof b.custom === "object" ? b.custom : {},
            grab: b.grab && typeof b.grab === "object" ? b.grab : (db.plan.grab || {}),
            opts: b.opts && typeof b.opts === "object" ? b.opts : (db.plan.opts || {})
          };
          saveDB();
        }
        return json(res, 200, { ok: true });
      }
    }
    /* ---- 天气（30 分钟缓存） ---- */
    if (p === "/api/weather") {
      const w = await getWeather(url.searchParams.get("force") === "1");
      return json(res, 200, { ...w, trip: weatherTrip() });
    }
    /* ---- 行程骨架（算法层直出，可强制用假想降水测试） ---- */
    const skm = p.match(/^\/api\/skeleton\/(d[1-6])$/);
    if (skm && req.method === "GET") {
      const pop = url.searchParams.get("pop");
      return json(res, 200, skeletonFor(skm[1], pop === null ? {} : { pop: +pop }));
    }
    /* ---- 记账（行内编辑 = PATCH；POST 可带 id 供撤销恢复） ---- */
    if (p === "/api/expenses") {
      if (req.method === "GET") return json(res, 200, db.expenses);
      if (req.method === "POST") {
        const b = await readBody(req);
        if (!b.name || !(b.amount > 0)) return json(res, 400, { error: "bad item" });
        const item = { id: typeof b.id === "string" && b.id ? b.id.slice(0, 24) : "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(b.name).slice(0, 30), amount: +b.amount, payer: b.payer === "B" ? "B" : "A", cat: ["eat", "move", "stay", "other"].includes(b.cat) ? b.cat : "other", note: String(b.note || "").slice(0, 40), ts: b.ts || Date.now() };
        if (!db.expenses.some(x => x.id === item.id)) db.expenses.push(item);
        saveDB();
        return json(res, 200, item);
      }
    }
    const em = p.match(/^\/api\/expenses\/([^/]+)$/);
    if (em) {
      const it = db.expenses.find(x => x.id === em[1]);
      if (req.method === "DELETE" && it) {
        db.expenses = db.expenses.filter(x => x.id !== em[1]); saveDB();
        return json(res, 200, { ok: true, item: it });
      }
      if (req.method === "PATCH" && it) {
        const b = await readBody(req);
        if (typeof b.name === "string" && b.name.trim()) it.name = b.name.trim().slice(0, 30);
        if (+b.amount > 0) it.amount = +b.amount;
        if (b.payer === "A" || b.payer === "B") it.payer = b.payer;
        if (["eat", "move", "stay", "other"].includes(b.cat)) it.cat = b.cat;
        if (typeof b.note === "string") it.note = b.note.slice(0, 40);
        saveDB();
        return json(res, 200, it);
      }
    }
    /* ---- 点评（经验沉淀） ---- */
    if (p === "/api/reviews") {
      if (req.method === "GET") return json(res, 200, db.reviews);
      if (req.method === "POST") {
        const b = await readBody(req);
        if (!b.spot || !b.text || !(b.stars >= 1 && b.stars <= 5)) return json(res, 400, { error: "bad review" });
        const r = { id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), spot: String(b.spot).slice(0, 20), author: b.author === "B" ? "B" : "A", stars: Math.round(+b.stars), text: String(b.text).slice(0, 120), ts: Date.now() };
        db.reviews.push(r); saveDB();
        return json(res, 200, r);
      }
    }
    const rm = p.match(/^\/api\/reviews\/([^/]+)$/);
    if (rm && req.method === "DELETE") { db.reviews = db.reviews.filter(x => x.id !== rm[1]); saveDB(); return json(res, 200, { ok: true }); }
    /* ---- 旅行日志（图片落盘 /files） ---- */
    if (p === "/api/journal") {
      if (req.method === "GET") return json(res, 200, db.journal);
      if (req.method === "POST") {
        const b = await readBody(req);
        if (!b.day || (!b.text && !(Array.isArray(b.images) && b.images.length))) return json(res, 400, { error: "empty entry" });
        fs.mkdirSync(UPLOADS, { recursive: true });
        const id = "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const imgs = [];
        for (const durl of (b.images || []).slice(0, 9)) {
          const m = String(durl).match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
          if (!m) continue;
          const ext = m[1] === "jpeg" ? "jpg" : m[1];
          const f = `${id}-${imgs.length}.${ext}`;
          fs.writeFileSync(path.join(UPLOADS, f), Buffer.from(m[2], "base64"));
          imgs.push("/files/" + f);
        }
        const entry = { id, day: String(b.day).slice(0, 8), text: String(b.text || "").slice(0, 800), imgs, ts: Date.now() };
        if (!entry.text && !entry.imgs.length) return json(res, 400, { error: "empty entry" });
        db.journal.push(entry); saveDB();
        return json(res, 200, entry);
      }
    }
    const jm = p.match(/^\/api\/journal\/([^/]+)$/);
    if (jm && req.method === "DELETE") {
      const e = db.journal.find(x => x.id === jm[1]);
      if (e) {
        e.imgs.forEach(f => { try { fs.unlinkSync(path.join(UPLOADS, path.basename(f))); } catch { } });
        db.journal = db.journal.filter(x => x.id !== jm[1]); saveDB();
      }
      return json(res, 200, { ok: true });
    }
    if (p.startsWith("/files/")) {
      const f = path.normalize(path.join(UPLOADS, path.basename(p)));
      if (!f.startsWith(UPLOADS)) { res.writeHead(403); return res.end("Forbidden"); }
      return serveFile(res, f, "public, max-age=86400");
    }
    /* ---- 抢票作战室任务状态 ---- */
    if (p === "/api/grab") {
      if (req.method === "GET") return json(res, 200, db.grab);
      if (req.method === "PUT") {
        const b = await readBody(req);
        if (b && typeof b.tasks === "object") db.grab.tasks = b.tasks;
        if (b && typeof b.notified === "object") db.grab.notified = b.notified;
        saveDB();
        return json(res, 200, { ok: true });
      }
    }
    /* ---- 设置（人员 / Server酱 / 可选项目开关） ---- */
    if (p === "/api/settings") {
      if (req.method === "GET") return json(res, 200, { people: db.settings.people, hasKey: !!db.settings.serverchan, optOff: db.settings.optOff });
      if (req.method === "PUT") {
        const b = await readBody(req);
        if (Array.isArray(b.people) && b.people.length === 2) db.settings.people = b.people.map(x => String(x).slice(0, 8));
        if (typeof b.serverchan === "string") db.settings.serverchan = b.serverchan.trim().slice(0, 64);
        if (b.optOff && typeof b.optOff === "object") { db.settings.optOff = b.optOff; }
        saveDB();
        return json(res, 200, { ok: true });
      }
    }
    /* ---- Server酱推送 ---- */
    if (p === "/api/notify" && req.method === "POST") {
      const b = await readBody(req);
      try { const r = await serverchanSend(String(b.desp || "").slice(0, 800), String(b.title || "").slice(0, 32)); return json(res, 200, { ok: true, resp: r }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    /* ---- AI（模型链式） ---- */
    if (p === "/api/chat" && req.method === "POST") {
      const b = await readBody(req);
      const msgs = Array.isArray(b.messages) ? b.messages.slice(-MAX_HIST) : [];
      if (!msgs.length) return json(res, 400, { error: "no messages" });
      // 发给模型：瘦身历史 + 末条用户消息保留原图（只有最新一张图参与识别，记忆里永不存图）
      const slimmed = msgs.slice(0, -1).map(slimMsg);
      const last = msgs[msgs.length - 1];
      const payload = [...slimmed, last].map(m => typeof m.content === "string" ? { role: m.role, content: m.content } : m);
      try {
        const { reply, model, tried } = await arkChain([{ role: "system", content: buildSystemPrompt() }, ...payload]);
        // 存库一律瘦身：服务端记忆不带 base64，GET history / 下次请求的 body 永远轻
        db.chat = msgs.map(slimMsg).concat([{ role: "assistant", content: reply }]).slice(-MAX_HIST);
        saveDB();
        return json(res, 200, { reply, model, fellBack: tried.length > 0 });
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (p === "/api/chat/history") {
      if (req.method === "GET") {
        // 自愈：旧版本记忆里可能残留 base64 大图，返回瘦身版并顺手重写一次
        if (db.chat.some(m => typeof m.content !== "string" && JSON.stringify(m).includes("image_url"))) {
          db.chat = db.chat.map(slimMsg); saveDB();
          console.log("[CHAT] 历史记忆已自愈瘦身");
        }
        return json(res, 200, db.chat);
      }
      if (req.method === "DELETE") { db.chat = []; saveDB(); return json(res, 200, { ok: true }); }
    }
    if (p.startsWith("/api/")) return json(res, 404, { error: "not found" });
    serveStatic(req, res, p);
  } catch (e) {
    json(res, 500, { error: e.message || "server error" });
  }
});

const PORT = process.env.PORT || 3000;
// 进程级护栏：任何未捕获异常只记日志，绝不让沙箱进程挂掉（挂掉 = 网关 502）
process.on("unhandledRejection", e => console.error("[GUARD] unhandledRejection:", (e && e.message) || e));
process.on("uncaughtException", e => console.error("[GUARD] uncaughtException:", (e && e.message) || e));
loadDB();
server.listen(PORT, () => console.log(`汴京秋行 2.0 · http://localhost:${PORT} · 文字链: ${CHAIN_TEXT.join(" → ")} · 带图链: ${CHAIN_VISION.join(" → ")}`));
