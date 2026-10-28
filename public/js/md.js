/* 汴京秋行 2.0 · 迷你 Markdown 渲染器（详情卡情报用，全部转义后再增强） */
(function () {
  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
        const safe = /^(https?:|\/)/.test(u) ? u : "#";
        return `<a href="${safe}" target="_blank" rel="noopener">${t}</a>`;
      });
  }

  /* 支持：###/## 标题、表格、无序/有序列表、引用、段落 */
  function md(src) {
    if (!src) return "";
    const lines = esc(src).split(/\r?\n/);
    let html = "", i = 0;
    const flushP = buf => { if (buf.length) html += `<p>${buf.map(inline).join("<br>")}</p>`; buf.length = 0; };
    const para = [];
    while (i < lines.length) {
      const ln = lines[i];
      if (/^\s*$/.test(ln)) { flushP(para); i++; continue; }
      // 表格
      if (/^\|.*\|/.test(ln) && /^\|[\s:|-]+\|/.test(lines[i + 1] || "")) {
        const head = ln.split("|").slice(1, -1).map(s => s.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && /^\|.*\|/.test(lines[i])) {
          rows.push(lines[i].split("|").slice(1, -1).map(s => s.trim())); i++;
        }
        html += `<div class="md-tablewrap"><table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>` +
          rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") + `</tbody></table></div>`;
        continue;
      }
      // 标题
      const h = ln.match(/^(#{2,4})\s+(.*)/);
      if (h) { flushP(para); html += `<h4 class="md-h${h[1].length}">${inline(h[2])}</h4>`; i++; continue; }
      // 引用
      if (/^&gt;\s?/.test(ln) || /^>\s?/.test(ln)) {
        flushP(para);
        const q = [];
        while (i < lines.length && (/^&gt;/.test(lines[i]) || /^>/.test(lines[i]))) { q.push(lines[i].replace(/^(&gt;|>)\s?/, "")); i++; }
        html += `<blockquote>${q.map(inline).join("<br>")}</blockquote>`;
        continue;
      }
      // 列表
      if (/^[-*]\s+/.test(ln) || /^\d+[.、]\s*/.test(ln)) {
        flushP(para);
        const ordered = /^\d+[.、]/.test(ln);
        const items = [];
        while (i < lines.length && (/^[-*]\s+/.test(lines[i]) || /^\d+[.、]\s*/.test(lines[i]))) {
          items.push(lines[i].replace(/^([-*]|\d+[.、])\s+/, "")); i++;
        }
        html += `<${ordered ? "ol" : "ul"} class="md-list">${items.map(x => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;
        continue;
      }
      para.push(ln); i++;
    }
    flushP(para);
    return html;
  }

  window.MD = { md, esc, inline };
})();
