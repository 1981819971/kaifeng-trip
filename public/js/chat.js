/* 汴京秋行 · 随身向导 AI（豆包方舟 · 文字/语音/拍照 · 服务端记忆） */
(function () {
  const { $, esc, toast } = UI;
  let history = [];        // [{role, content}] content 为字符串或 [{type:text},{type:image_url...}]
  let busy = false;
  let recog = null, recording = false;
  let pendingImage = null; // {name, dataUrl}

  const el = {
    list: () => $("#chatList"),
    input: () => $("#chatInput"),
    send: () => $("#chatSend"),
    mic: () => $("#chatMic"),
    img: () => $("#chatImg"),
    imgInput: () => $("#chatImgInput"),
    preview: () => $("#chatPreview"),
    clear: () => $("#chatClear")
  };

  function bubble(role, html) {
    const div = document.createElement("div");
    div.className = `chat-msg ${role}`;
    div.innerHTML = `
      <span class="chat-avatar">${role === "ai" ? UI.icon("bot") : "菲"}</span>
      <div class="chat-body"><div class="chat-text">${html}</div></div>`;
    el.list().appendChild(div);
    div.scrollIntoView({ behavior: "smooth", block: "end" });
    return div;
  }

  function mdLite(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, "<br>");
  }

  /* —— 行程修改补丁：[[PLAN_PATCH]]{json}[[/PLAN_PATCH]] —— */
  function extractPatch(reply) {
    const m = String(reply).match(/\[\[PLAN_PATCH\]\]([\s\S]+?)\[\[\/PLAN_PATCH\]\]/);
    if (!m) return { text: reply, patch: null };
    const text = String(reply).replace(/\[\[PLAN_PATCH\]\][\s\S]*$/, "").trim();
    let patch = null;
    try { patch = JSON.parse(m[1].trim()); } catch { patch = null; }
    return { text, patch: patch && patch.days && Object.keys(patch.days).length ? patch : null };
  }

  function dayLabel(id) {
    const idx = (window.TRIP_DAYS || []).findIndex(d => d.id === id);
    const d = idx >= 0 ? TRIP_DAYS[idx] : null;
    return d ? `D${idx + 1} ${d.date} ${d.theme}` : id;
  }

  function patchCard(patch) {
    const wrap = document.createElement("div");
    wrap.className = "chat-msg ai";
    const rows = Object.entries(patch.days).map(([id, p]) => {
      const items = (p.items || []).map(it =>
        `<li><span class="pp-time">${esc(it.time || "--:--")}</span><b>${esc(it.title || "")}</b><small>${esc(String(it.desc || "").replace(/\*\*/g, ""))}</small></li>`).join("");
      return `<div class="pp-day"><b>📆 ${esc(dayLabel(id))}</b><ul>${items}</ul></div>`;
    }).join("");
    wrap.innerHTML = `
      <span class="chat-avatar">${UI.icon("sparkles")}</span>
      <div class="chat-body"><div class="chat-text plan-patch">
        <b>🛠 检测到行程修改请求</b>
        <p class="pp-tip">确认后会替换第一板块对应日期的日程（原勾选进度清零），并同步到云端。不改就点取消。</p>
        ${rows}
        <div class="pp-ops">
          <button class="btn primary sm" data-pp-yes>✓ 确认修改</button>
          <button class="btn ghost sm" data-pp-no>取消</button>
        </div>
      </div></div>`;
    el.list().appendChild(wrap);
    wrap.scrollIntoView({ behavior: "smooth", block: "end" });
    const done = html => {
      wrap.querySelectorAll(".pp-ops button").forEach(b => b.remove());
      const tip = wrap.querySelector(".pp-tip");
      if (tip) tip.innerHTML = html;
    };
    wrap.querySelector("[data-pp-yes]").onclick = () => {
      const r = window.Plan && Plan.applyPatch(patch);
      done(r ? `✅ 已应用修改（${r.join("、")}），第一板块已更新，云端已同步` : "⚠️ 补丁无法应用（日期不匹配）");
      if (r) toast("行程已更新，云端已同步");
      wrap.scrollIntoView({ behavior: "smooth", block: "end" });
    };
    wrap.querySelector("[data-pp-no]").onclick = () => { done("已取消，行程保持原样。"); };
    return wrap;
  }

  let thinkTimer = null;
  function think(on) {
    busy = on;
    el.send().disabled = on;
    el.send().classList.toggle("loading", on);
    let t = $("#chatThinking");
    if (on && !t) {
      t = document.createElement("div");
      t.id = "chatThinking";
      t.className = "chat-msg ai";
      t.innerHTML = `<span class="chat-avatar">${UI.icon("bot")}</span><div class="chat-body"><div class="chat-text typing"><i></i><i></i><i></i><span id="thinkSec" style="margin-left:6px;font-size:12px;opacity:.65"></span></div></div>`;
      el.list().appendChild(t);
      t.scrollIntoView({ behavior: "smooth", block: "end" });
      const t0 = Date.now();
      thinkTimer = setInterval(() => {
        const s = Math.round((Date.now() - t0) / 1000);
        const n = $("#thinkSec");
        if (n) n.textContent = s >= 4 ? `已想 ${s}s` : "";
        else clearInterval(thinkTimer);
      }, 1000);
    }
    if (!on && t) { clearInterval(thinkTimer); t.remove(); }
  }

  async function loadHistory() {
    try {
      const data = await Store.API.getChat();
      history = Array.isArray(data) ? data : [];
      history.forEach(m => {
        const text = typeof m.content === "string"
          ? m.content
          : (m.content || []).filter(c => c.type === "text").map(c => c.text).join(" ");
        if (text) bubble(m.role === "assistant" ? "ai" : "user", mdLite(extractPatch(text).text));
      });
    } catch { /* 静默：首次无历史 */ }
    if (!history.length) {
      bubble("ai", "我在～我是这次的随身向导 🐎<br>车次、门票、路线、吃的、改行程——直接问，不用客气。也可以<b>点麦克风语音问</b>，或者<b>拍张照片</b>给我看看。");
    }
    busy = false;  // 记忆就位，解锁发送
  }

  async function send(text, imageDataUrl, opts) {
    if (busy) { toast("向导还在想上一条呢，稍等一秒", "warn"); return; }
    text = (text || "").trim();
    if (!text && !imageDataUrl) return;

    // 用户气泡（含图片预览）
    const mine = bubble("user",
      (imageDataUrl ? `<img class="chat-img" src="${imageDataUrl}" alt="提问图片">` : "") +
      (text ? mdLite(text) : ""));

    const content = [];
    if (imageDataUrl) content.push({ type: "image_url", image_url: { url: imageDataUrl } });
    if (text) content.push({ type: "text", text });
    if (!content.length) return;
    history.push({ role: "user", content: content.length === 1 && content[0].type === "text" ? text : content, _pending: true });

    think(true);
    try {
      const r = await Store.API.sendChat({ messages: history.slice(-40) });
      history.push({ role: "assistant", content: r.reply });
      history.forEach(m => { delete m._pending; });
      // 图片瘦身：历史里的 base64 图替换成占位文本，防止请求越滚越大导致超时
      history = history.map(m => typeof m.content === "string" ? m : {
        role: m.role,
        content: (m.content || []).filter(c => c.type === "text").map(c => c.text).join(" ") || "[图片]"
      });
      const { text, patch } = extractPatch(r.reply);
      bubble("ai", mdLite(text) + (r.model ? `<div class="chat-model">${r.fellBack ? "⛓ 链式降级 → " : ""}${esc(r.model)}</div>` : ""));
      if (patch) patchCard(patch);
      Store.setOnline(true);
    } catch (e) {
      // 失败回滚：这条 user 消息不入史，避免重试时重复；图片放回预览，点发送即可原样重发
      const lastMsg = history[history.length - 1];
      if (lastMsg && lastMsg.role === "user" && lastMsg._pending) {
        history.pop();
        pendingImage = imageDataUrl || null;
        if (pendingImage) {
          el.preview().innerHTML = `<img src="${pendingImage}" alt=""><button type="button" id="pvDel" aria-label="移除图片">×</button>`;
          el.preview().classList.add("show");
          $("#pvDel").onclick = () => { pendingImage = null; el.preview().classList.remove("show"); el.preview().innerHTML = ""; };
        }
      }
      const hasPendingImg = lastMsg && lastMsg.role === "user" && lastMsg._pending && imageDataUrl;
      const why = /abort/i.test(e.message) ? "等了 45 秒还没回，已自动打断" : e.message;
      bubble("ai", "网络开小差了（" + esc(why) + "）。" +
        (hasPendingImg ? "<b>图已放回输入框，直接点发送重试</b>" : "<b>话已放回输入框，直接点发送重试</b>") +
        "；还不行就等一两分钟，服务器可能在小憩。");
      // 把没发出去的话放回输入框，方便一键重发
      if (text && (!opts || !opts.noRestore)) { el.input().value = text; }
    }
    think(false);
  }

  /* —— 语音识别（Edge/Chrome 原生 SpeechRecognition）—— */
  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { el.mic().disabled = true; el.mic().title = "当前浏览器不支持语音"; return; }
    recog = new SR();
    recog.lang = "zh-CN";
    recog.continuous = false;
    recog.interimResults = true;
    let finalText = "";
    recog.onstart = () => { recording = true; el.mic().classList.add("rec"); toast("在听呢，请讲～"); };
    recog.onresult = e => {
      let interim = "";
      for (const res of e.results) {
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      el.input().value = finalText || interim;
    };
    recog.onerror = ev => {
      recording = false; el.mic().classList.remove("rec");
      toast(ev.error === "not-allowed" ? "需要允许麦克风权限" : "没听清，再试一次？", "warn");
    };
    recog.onend = () => {
      recording = false; el.mic().classList.remove("rec");
      if (finalText.trim()) send(finalText.trim(), pendingImage);
      finalText = "";
    };
    el.mic().onclick = () => {
      if (busy) return;
      if (recording) { recog.stop(); return; }
      finalText = "";
      try { recog.start(); } catch { /* 已启动 */ }
    };
  }

  /* —— 拍照 / 相册 / 文件选图（大图自动压缩）—— */
  // iOS 内存受限时 canvas.toDataURL 会不抛异常而返回 "data:,"（空图）——用 toBlob + 严格校验兜死
  function validImg(d) {
    return typeof d === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(d) && d.length > 500;
  }
  function canvasToDataUrl(cv) {
    return new Promise(resolve => {
      if (cv.toBlob) {
        cv.toBlob(b => {
          if (!b) return resolve(null);
          const rd = new FileReader();
          rd.onload = () => resolve(validImg(rd.result) ? rd.result : null);
          rd.onerror = () => resolve(null);
          rd.readAsDataURL(b);
        }, "image/jpeg", 0.85);
      } else {
        try {
          const d = cv.toDataURL("image/jpeg", 0.85);
          resolve(validImg(d) ? d : null);
        } catch { resolve(null); }
      }
    });
  }
  async function compressImage(dataUrl) {
    try {
      const img = await new Promise((ok, bad) => {
        const i = new Image();
        i.onload = () => ok(i); i.onerror = bad; i.src = dataUrl;
      });
      const MAX = 1600, scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      const ctx = cv.getContext("2d");
      if (!ctx) return dataUrl;
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const out = await canvasToDataUrl(cv);
      return out || dataUrl;   // 压缩产出无效 → 退回原图（原图有效性由调用方校验）
    } catch { return dataUrl; }
  }

  function initImage() {
    el.img().onclick = () => el.imgInput().click();
    el.imgInput().onchange = async () => {
      const f = el.imgInput().files[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) { toast("图片太大（>15MB），换张小点的", "warn"); return; }
      const rd = new FileReader();
      rd.onload = async () => {
        let dataUrl = rd.result;
        if (f.size > 3 * 1024 * 1024) {          // 相册原图压缩到 ≤1600px，避免请求超长
          toast("图有点大，正在压缩…");
          dataUrl = await compressImage(dataUrl);
        }
        if (!validImg(dataUrl)) {                // 终检：坏图绝不出门（方舟会直接拒收）
          toast("图片处理失败了，换一张或截图后再试", "warn");
          return;
        }
        pendingImage = dataUrl;
        el.preview().innerHTML = `<img src="${pendingImage}" alt=""><button type="button" id="pvDel" aria-label="移除图片">×</button>`;
        el.preview().classList.add("show");
        $("#pvDel").onclick = () => { pendingImage = null; el.preview().classList.remove("show"); el.preview().innerHTML = ""; };
        toast("图已就位，输入问题（可不填）后发送");
      };
      rd.readAsDataURL(f);
      el.imgInput().value = "";
    };
  }

  function init() {
    busy = true;  // 历史加载完成前禁发：避免空 history 覆盖服务端记忆
    el.send().onclick = () => {
      if (busy) { toast("向导还在准备记忆，一秒就好", "warn"); return; }
      const t = el.input().value;
      const img = pendingImage;
      el.input().value = "";
      pendingImage = null;
      el.preview().classList.remove("show");
      el.preview().innerHTML = "";
      send(t, img);
    };
    el.input().addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.send().click(); }
    });
    el.clear().onclick = async () => {
      if (!confirm("清空全部对话记忆？")) return;
      busy = true;
      try { await Store.API.clearChat(); } catch { /* 忽略 */ }
      history = [];
      el.list().innerHTML = "";
      await loadHistory();
      busy = false;
      toast("已清空");
    };
    initVoice();
    initImage();
    loadHistory();
  }

  window.Chat = { init, patchCard };
})();
