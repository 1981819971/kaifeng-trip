/* 汴京秋行 2.0 · 公摊记账（吃/行/住/其他 · 云端持久化 · 行内编辑 + 撤销删除 + 人员可配置） */
(function () {
  const { $, $$, esc, toast } = UI;
  const CATS = {
    eat: { label: "吃", color: "var(--orange)" },
    move: { label: "行", color: "var(--sky-deep)" },
    stay: { label: "住", color: "var(--purple)" },
    other: { label: "其他", color: "var(--ink-faint)" }
  };
  let list = [];
  let cat = "eat";
  let people = ["三弦闲", "神神神"];   // /api/settings 可配置
  let lastDeleted = null;              // 撤销删除缓冲

  const money = n => "¥" + Number(n).toFixed(2).replace(/\.00$/, "");
  const P = k => people[k === "B" ? 1 : 0] || (k === "B" ? "朋友" : "我");

  async function loadPeople() {
    try { const s = await Store.API.j("/api/settings"); if (s && s.people) { people = s.people; window._people = s.people; } } catch { }
  }

  async function load() {
    try {
      list = await Store.API.getExpenses();
      render(); Store.setOnline(true);
    } catch {
      list = []; toast("记账云同步不可用，先离线浏览", "warn"); render();
    }
  }

  async function add(e) {
    e.preventDefault();
    const name = $("#expName").value.trim();
    const amount = parseFloat($("#expAmount").value);
    if (!name || !(amount > 0)) return toast("项目名和金额都要填哦", "warn");
    const payer = $("#expPayer").value;
    const note = $("#expNote").value.trim();
    if (cat === "other" && !note) return toast("「其他」类请写明用途，回看才不懵", "warn");
    const item = { name, amount, payer, cat, note, ts: Date.now() };
    try {
      const saved = await Store.API.addExpense(item);
      list.push(saved); render(); e.target.reset(); catPickRender();
      (window.Dashboard && Dashboard.refresh());
      toast("已记入账本 ✓");
    } catch { toast("云端没连上，这笔没存进去", "warn"); }
  }

  async function del(id) {
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return;
    lastDeleted = list[idx];
    try {
      await Store.API.delExpense(id);
      list.splice(idx, 1); render(); (window.Dashboard && Dashboard.refresh());
      toastUndo(`已删除「${lastDeleted.name}」`);
    } catch { toast("删除失败", "warn"); }
  }
  function toastUndo(msg) {
    const t = $("#toast");
    t.innerHTML = `${esc(msg)} <button class="toast-undo" id="undoBtn">撤销</button>`;
    t.className = "toast show";
    clearTimeout(t._tm);
    t._tm = setTimeout(() => (t.className = "toast"), 6000);
    $("#undoBtn").onclick = undo;
  }
  async function undo() {
    if (!lastDeleted) return;
    const item = { ...lastDeleted };              // 原 id 一起带回，幂等
    try {
      const saved = await Store.API.j("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
      if (!list.some(x => x.id === saved.id)) list.push(saved);
      lastDeleted = null; render(); (window.Dashboard && Dashboard.refresh());
      toast("已撤销删除 ✓");
    } catch { toast("撤销失败", "warn"); }
  }

  /* 行内编辑：点击行进入编辑态，保存 = PATCH */
  function startEdit(row, x) {
    if (row.querySelector("input")) return;
    row.classList.add("editing");
    row.innerHTML = `
      <input class="ed-name" value="${esc(x.name)}" maxlength="30">
      <input class="ed-amt" type="number" min="0.01" step="0.01" value="${x.amount}">
      <select class="ed-payer">${[0, 1].map(i => `<option value="${i ? "B" : "A"}" ${x.payer === (i ? "B" : "A") ? "selected" : ""}>${esc(people[i])}</option>`).join("")}</select>
      <select class="ed-cat">${Object.keys(CATS).map(k => `<option value="${k}" ${x.cat === k ? "selected" : ""}>${CATS[k].label}</option>`).join("")}</select>
      <input class="ed-note" value="${esc(x.note || "")}" maxlength="40" placeholder="备注">
      <button class="btn sky sm ed-save">存</button>
      <button class="btn ghost sm ed-cancel">取消</button>`;
    row.querySelector(".ed-save").onclick = async () => {
      const body = {
        name: row.querySelector(".ed-name").value.trim() || x.name,
        amount: +row.querySelector(".ed-amt").value,
        payer: row.querySelector(".ed-payer").value,
        cat: row.querySelector(".ed-cat").value,
        note: row.querySelector(".ed-note").value.trim()
      };
      if (!(body.amount > 0)) return toast("金额要大于 0", "warn");
      const saved = await Store.API.j("/api/expenses/" + x.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      if (saved) { Object.assign(x, saved); render(); (window.Dashboard && Dashboard.refresh()); toast("已更新 ✓"); }
      else { render(); toast("更新失败", "warn"); }
    };
    row.querySelector(".ed-cancel").onclick = () => render();
    row.querySelector(".ed-name").focus();
  }

  function stats() {
    const sum = { A: 0, B: 0, all: 0 };
    const byCat = {};
    list.forEach(x => {
      sum[x.payer] += x.amount; sum.all += x.amount;
      byCat[x.cat] = (byCat[x.cat] || 0) + x.amount;
    });
    return { sum, byCat, per: sum.all / 2 };
  }

  function updatePayerSelect() {
    const sel = $("#expPayer");
    if (!sel) return;
    if (sel.options.length !== 2) sel.innerHTML = [0, 1].map(i => `<option value="${i ? "B" : "A"}">${esc(people[i])}</option>`).join("");
    else [0, 1].forEach(i => { if (sel.options[i]) sel.options[i].textContent = people[i]; });
  }

  function render() {
    const { sum, byCat, per } = stats();
    window.Expenses.raw = list;
    $("#expSummary").innerHTML = `
      <div class="exp-sum-card"><span class="k">总支出</span><span class="v">${money(sum.all)}</span></div>
      <div class="exp-sum-card"><span class="k">人均</span><span class="v">${money(per)}</span></div>
      <div class="exp-sum-card"><span class="k">${esc(P("A"))}垫付</span><span class="v">${money(sum.A)}</span></div>
      <div class="exp-sum-card"><span class="k">${esc(P("B"))}垫付</span><span class="v">${money(sum.B)}</span></div>`;

    $("#expList").innerHTML = list.length ? list.slice().reverse().map(x => `
      <div class="exp-row" data-id="${x.id}" title="点击行内编辑">
        <span class="dot" style="background:${CATS[x.cat]?.color || "var(--ink-faint)"}"></span>
        <div class="main">
          <b>${esc(x.name)}</b>
          <small>${esc(P(x.payer))}垫付 · ${CATS[x.cat]?.label}${x.note ? " · " + esc(x.note) : ""}</small>
        </div>
        <span class="amt">${money(x.amount)}</span>
        <button class="btn icon danger del" type="button" aria-label="删除">${UI.icon("trash")}</button>
      </div>`).join("")
      : `<div class="empty">还没有记录——出发后每天随手记，回校自动结算 ✓</div>`;

    $$("#expList .exp-row").forEach(row => {
      row.onclick = e => {
        if (e.target.closest(".del")) return;
        const x = list.find(v => v.id === row.dataset.id);
        if (x) startEdit(row, x);
      };
    });
    $$("#expList .del").forEach(b => b.onclick = e => { e.stopPropagation(); del(b.closest(".exp-row").dataset.id); });

    const diff = sum.A - sum.B;
    const settle = $("#settleCard");
    if (!list.length) { settle.innerHTML = `<span class="who">花了一笔就来结算吧～</span>`; return; }
    if (Math.abs(diff) < 0.01) settle.innerHTML = `<span class="who">两人垫付刚好持平，谁也不用给谁钱 🎉</span>`;
    else if (diff > 0) settle.innerHTML = `<span class="who">目前 ${esc(P("B"))} 欠 ${esc(P("A"))}</span><span class="amount">${money(diff / 2)}</span><span class="who">（差额 ${money(diff)} 的一半）</span>`;
    else settle.innerHTML = `<span class="who">目前 ${esc(P("A"))} 欠 ${esc(P("B"))}</span><span class="amount">${money(-diff / 2)}</span><span class="who">（差额 ${money(-diff)} 的一半）</span>`;

    /* 垫付人选项随设置走（render 早退路径之外也保证执行） */
    updatePayerSelect();
  }

  function catPickRender() {
    $$("#catPick .chip-cat").forEach(b => b.classList.toggle("active", b.dataset.cat === cat));
  }

  async function init() {
    if (!$("#expForm")) return;
    $("#expForm").onsubmit = add;
    $$("#catPick .chip-cat").forEach(b => b.onclick = () => { cat = b.dataset.cat; catPickRender(); });
    catPickRender();
    updatePayerSelect();
    await loadPeople();
    await load();
    (window.Dashboard && Dashboard.refresh());
  }
  window.Expenses = { init, stats, get raw() { return list; } };
})();
