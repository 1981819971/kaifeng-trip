/* 汴京秋行 · 状态与云端同步（REST API /api/*） */
(function () {
  const { $, toast } = UI;
  const API = {
    async j(url, opt) {
      try {
        const r = await fetch(url, opt);
        if (!r.ok) {
          // 尽量把服务端真实错误带出来，别只报 HTTP 状态码
          let detail = "";
          try { detail = (await r.json()).error || ""; } catch { }
          throw new Error(detail ? `${detail}（HTTP ${r.status}）` : `HTTP ${r.status}`);
        }
        return await r.json();
      } catch (e) {
        setOnline(false);
        throw e;
      }
    },
    getPlan: () => API.j("/api/plan"),
    putPlan: (data) => API.j("/api/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    getExpenses: () => API.j("/api/expenses"),
    addExpense: (e) => API.j("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e) }),
    delExpense: (id) => API.j(`/api/expenses/${id}`, { method: "DELETE" }),
    getChat: () => API.j("/api/chat/history"),
    sendChat: (payload) => {
      // 客户端兜底超时：后端模型链总预算 28s，45s 还没回必然是链路挂死，主动断开给用户明确报错
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      return API.j("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal })
        .finally(() => clearTimeout(timer));
    },
    clearChat: () => API.j("/api/chat/history", { method: "DELETE" })
  };

  function setOnline(on) {
    document.body.classList.toggle("offline", !on);
    const b = $("#syncBadge");
    if (b) b.className = on ? "sync-badge" : "sync-badge offline";
  }

  /* 防抖整档同步行程 */
  let planTimer = null;
  function syncPlan(state) {
    clearTimeout(planTimer);
    setSyncing(true);
    planTimer = setTimeout(async () => {
      try { await API.putPlan(state); setSyncing(false); setOnline(true); }
      catch { setSyncing(false); toast("云端同步失败，改动已存本地", "warn"); }
    }, 800);
  }
  function setSyncing(on) {
    const b = $("#syncBadge");
    if (b) b.dataset.state = on ? "syncing" : "idle";
  }

  window.Store = { API, syncPlan, setOnline };
})();
