/* 汴京秋行 2.0 · 旅行日志与照片墙（图片压缩落盘 /files，回校可回顾） */
(function () {
  const { $, $$, esc, toast } = UI;
  /* 日程标题统一从 TRIP_DAYS 生成，杜绝与行程页/舆图/向导口径打架 */
  const DAY_NAMES = Object.fromEntries((window.TRIP_DAYS || []).map((d, i) => [d.id, "D" + (i + 1) + " " + d.theme]));

  let entries = [];

  async function load() {
    try { entries = await Store.API.j("/api/journal"); } catch { entries = []; }
  }

  /* 客户端压缩：最长边 1280，JPEG 0.72 —— 控制体积与流量 */
  function compress(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function render() {
    const grid = $("#journalGrid");
    if (!grid) return;
    const byDay = {};
    entries.slice().sort((a, b) => b.ts - a.ts).forEach(e => { (byDay[e.day] = byDay[e.day] || []).push(e); });
    grid.innerHTML = Object.keys(DAY_NAMES).map(day => {
      const list = byDay[day] || [];
      const imgs = list.flatMap(e => e.imgs);
      return `<div class="jr-day" data-jrday="${day}">
        <div class="jr-head"><b>${DAY_NAMES[day]}</b><span>${list.length ? list.length + " 篇 · " + imgs.length + " 张" : "还没动笔"}</span>
          <button class="btn sky sm" data-jradd="${day}">＋ 写日志</button></div>
        ${list.length ? list.map(e => `
          <div class="jr-entry">
            <div class="jr-text">${esc(e.text)}</div>
            ${e.imgs.length ? `<div class="jr-imgs">${e.imgs.map(f => `<img src="${f}" alt="照片" loading="lazy">`).join("")}</div>` : ""}
            <div class="jr-foot"><small>${new Date(e.ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
              <button class="rev-del" data-jrdel="${e.id}" aria-label="删除">✕</button></div>
          </div>`).join("") : `<p class="gd-empty">当天写点什么吧——哪怕一句「打铁花排了 40 分钟，值」。</p>`}
      </div>`;
    }).join("");

    $$("[data-jradd]", grid).forEach(b => b.onclick = () => openEditor(b.dataset.jradd));
    $$("[data-jrdel]", grid).forEach(b => b.onclick = async () => {
      const r = await Store.API.j("/api/journal/" + b.dataset.jrdel, { method: "DELETE" }).catch(() => null);
      if (r) { entries = entries.filter(x => x.id !== b.dataset.jrdel); render(); toast("已删除"); }
    });
    renderRetrospect();
  }

  function openEditor(day) {
    const mask = $("#jrMask");
    mask.classList.add("show");
    $("#jrDay").value = day;
    $("#jrText").value = "";
    $("#jrImgs").value = "";
    $("#jrPre").innerHTML = "";
    $("#jrSave")._files = [];
    setTimeout(() => $("#jrText").focus(), 200);
  }
  function closeEditor() { $("#jrMask").classList.remove("show"); }

  function bindEditor() {
    const save = $("#jrSave");
    $("#jrImgs").onchange = async e => {
      const files = [...e.target.files].slice(0, 9);
      save._files = [];
      $("#jrPre").innerHTML = "<small>压缩中…</small>";
      const urls = [];
      for (const f of files) { try { urls.push(await compress(f)); } catch { } }
      save._files = urls;
      $("#jrPre").innerHTML = urls.length ? urls.map(u => `<img src="${u}" alt="预览">`).join("") : "<small>没有可用图片</small>";
    };
    save.onclick = async () => {
      const text = $("#jrText").value.trim();
      const images = save._files || [];
      if (!text && !images.length) return toast("写一句话或选张照片", "warn");
      save.disabled = true;
      const r = await Store.API.j("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day: $("#jrDay").value, text, images }) }).catch(e => ({ error: e.message }));
      save.disabled = false;
      if (r.error) return toast("保存失败：" + r.error, "warn");
      entries.push(r); closeEditor(); render(); toast("已归档 ✓");
    };
    $("#jrCancel").onclick = closeEditor;
    $("#jrMask").onclick = e => { if (e.target.id === "jrMask") closeEditor(); };
  }

  /* 回校回顾长图：全部日志拼成长卡片，可长按保存（离线可用） */
  function renderRetrospect() {
    const box = $("#jrRetro");
    if (!box) return;
    if (!entries.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<h3 class="sub-h">🎞 回顾长卷（生成后可截图保存）</h3>
      <div class="jr-retro" id="jrRetroCard">
        <b class="jr-rt">汴京秋行 · 六日长卷</b>
        ${Object.keys(DAY_NAMES).map(day => {
      const list = (entries.filter(e => e.day === day)).sort((a, b) => a.ts - b.ts);
      if (!list.length) return "";
      return `<div class="jr-rt-day">${DAY_NAMES[day]}</div>` +
        list.map(e => `<div class="jr-rt-entry">${esc(e.text)}${e.imgs.map(f => `<img src="${f}" loading="lazy">`).join("")}</div>`).join("");
    }).join("")}
        <small class="jr-rt-foot">三弦闲 & 神神神 · 2026 国庆 · 开封</small>
      </div>`;
  }

  async function init() {
    if (!$("#journalGrid")) return;
    const daySel = $("#jrDay");
    if (daySel && !daySel.options.length) {
      daySel.innerHTML = Object.keys(DAY_NAMES).map(d => `<option value="${d}">${DAY_NAMES[d]}</option>`).join("");
    }
    bindEditor();
    await load();
    render();
  }
  window.Journal = { init };
})();
