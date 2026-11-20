/*
 * Leitor QR - Peppe · report.js
 * Renderizador de relatório em PDF (A4) a partir de uma lista de blocos, usando jsPDF.
 * Sem DOM: funciona no navegador (window.PeppeReport) e no Node (tests/report.test.js).
 *
 * spec = {
 *   meta: { title, subject },
 *   footer: { left, disclaimer, page: "Página {p} de {n}" },
 *   blocks: [
 *     { type: "title", title, subtitle, meta },
 *     { type: "heading", text },
 *     { type: "kv", items: [{ label, value }] },
 *     { type: "callout", level: "ok|warn|bad", text },
 *     { type: "table", cols: [{ title, w, align?, mono?, level?, maxLines? }], rows: [{ cells: [], level?, sub? }], empty },
 *     { type: "note", text }
 *   ]
 * }
 * Cor nunca é o único sinal: toda situação também aparece em texto.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PeppeReport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const COLOR = {
    ink: [20, 34, 56], muted: [96, 115, 142], line: [216, 225, 237], head: [229, 237, 247], zebra: [246, 249, 253],
    band: [16, 24, 39], accent: [110, 231, 183],
    ok: [6, 112, 80], warn: [146, 96, 0], bad: [185, 40, 40],
    okBg: [231, 247, 240], warnBg: [255, 246, 224], badBg: [253, 234, 234], infoBg: [240, 244, 250]
  };
  const levelColor = l => COLOR[l] || COLOR.ink;
  const levelBg = l => COLOR[l + "Bg"] || COLOR.infoBg;

  // As fontes padrão do PDF cobrem Latin-1 (acentos do português/espanhol). Troca o que fica de fora.
  function safe(s) {
    return String(s == null ? "" : s)
      .replace(/[–—−]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/…/g, "...").replace(/[  ]/g, " ").replace(/•/g, "*")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[^\x20-\x7E¡-ÿ]/g, "?");
  }

  function build(jsPDF, spec) {
    const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const M = 40, CW = W - 2 * M, BOTTOM = H - 58;
    let y = M;

    const text = c => doc.setTextColor(c[0], c[1], c[2]);
    const fill = c => doc.setFillColor(c[0], c[1], c[2]);
    const stroke = c => doc.setDrawColor(c[0], c[1], c[2]);
    const font = (face, style, size) => { doc.setFont(face, style); doc.setFontSize(size); };
    const newPage = () => { doc.addPage(); y = M; };
    const ensure = h => { if (y + h > BOTTOM) { newPage(); return true; } return false; };
    const wrap = (s, width, maxLines) => {
      let lines = doc.splitTextToSize(safe(s), width);
      if (maxLines && lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, "...");
      }
      return lines;
    };

    if (spec.meta) doc.setProperties({ title: safe(spec.meta.title), subject: safe(spec.meta.subject || ""), creator: "Leitor QR - Peppe" });

    const draw = {
      title(b) {
        fill(COLOR.band); doc.rect(0, 0, W, 92, "F");
        fill(COLOR.accent); doc.rect(0, 92, W, 3, "F");
        font("helvetica", "bold", 20); text([255, 255, 255]); doc.text(safe(b.title), M, 42);
        font("helvetica", "normal", 11); text([200, 214, 232]);
        const sub = wrap(b.subtitle || "", CW, 2); doc.text(sub, M, 62);
        font("helvetica", "normal", 9); text([150, 170, 196]); doc.text(safe(b.meta || ""), M, 62 + sub.length * 13 + 2);
        y = 118;
      },
      heading(b) {
        ensure(60); y += 6;
        font("helvetica", "bold", 12.5); text(COLOR.ink); doc.text(safe(b.text), M, y + 11);
        stroke(COLOR.line); doc.setLineWidth(0.8); doc.line(M, y + 18, W - M, y + 18);
        y += 28;
      },
      kv(b) {
        const cols = 3, gap = 8, cw = (CW - gap * (cols - 1)) / cols, ch = 48;
        for (let i = 0; i < b.items.length; i += cols) {
          ensure(ch + 8);
          b.items.slice(i, i + cols).forEach((it, j) => {
            const x = M + j * (cw + gap);
            fill([255, 255, 255]); stroke(COLOR.line); doc.setLineWidth(0.8); doc.roundedRect(x, y, cw, ch, 5, 5, "FD");
            let size = 15; font("helvetica", "bold", size);
            while (size > 9 && doc.getTextWidth(safe(it.value)) > cw - 16) { size -= 1; doc.setFontSize(size); }
            text(COLOR.ink); doc.text(safe(it.value), x + 8, y + 21);
            font("helvetica", "normal", 8.5); text(COLOR.muted);
            doc.text(wrap(it.label, cw - 16, 2), x + 8, y + 34);
          });
          y += ch + gap;
        }
        y += 4;
      },
      callout(b) {
        font("helvetica", "normal", 9.5);
        const lines = wrap(b.text, CW - 26), h = lines.length * 12 + 12;
        ensure(h + 8);
        fill(levelBg(b.level)); doc.rect(M, y, CW, h, "F");
        fill(levelColor(b.level)); doc.rect(M, y, 4, h, "F");
        text(COLOR.ink); doc.text(lines, M + 14, y + 15);
        y += h + 8;
      },
      note(b) {
        font("helvetica", "normal", 8.5); text(COLOR.muted);
        const lines = wrap(b.text, CW);
        ensure(lines.length * 11 + 6);
        doc.text(lines, M, y + 9); y += lines.length * 11 + 8;
      },
      table(b) {
        if (!b.rows.length) { draw.note({ text: b.empty || "-" }); return; }
        const pad = 5, lineH = 10.5, widths = b.cols.map(c => c.w * CW);
        const xs = widths.reduce((a, w, i) => (a.push(i ? a[i - 1] + widths[i - 1] : M), a), []);
        const header = () => {
          fill(COLOR.head); doc.rect(M, y, CW, 20, "F");
          font("helvetica", "bold", 8.5); text(COLOR.ink);
          b.cols.forEach((c, i) => {
            const tx = c.align === "right" ? xs[i] + widths[i] - pad : xs[i] + pad;
            doc.text(safe(c.title), tx, y + 13, c.align === "right" ? { align: "right" } : undefined);
          });
          y += 20;
        };
        // mede a linha antes de desenhar, para nunca cortar no meio
        const measure = row => {
          const cells = b.cols.map((c, i) => {
            font(c.mono ? "courier" : "helvetica", "normal", c.mono ? 7.5 : 8.5);
            return wrap(row.cells[i], widths[i] - 2 * pad, c.maxLines || 4);
          });
          let sub = [];
          if (row.sub) { font("courier", "normal", 7); sub = wrap(row.sub, CW - 2 * pad, 5); }
          const main = Math.max(1, ...cells.map(c => c.length)) * lineH + 8;
          return { cells, sub, main, total: main + (sub.length ? sub.length * 8.6 + 4 : 0) };
        };
        const first = measure(b.rows[0]);
        ensure(20 + first.total); header();
        b.rows.forEach((row, ri) => {
          const m = measure(row);
          if (y + m.total > BOTTOM) { newPage(); header(); }
          if (ri % 2) { fill(COLOR.zebra); doc.rect(M, y, CW, m.total, "F"); }
          b.cols.forEach((c, i) => {
            const isLevel = c.level && row.level;
            font(c.mono ? "courier" : "helvetica", isLevel ? "bold" : "normal", c.mono ? 7.5 : 8.5);
            text(isLevel ? levelColor(row.level) : COLOR.ink);
            const tx = c.align === "right" ? xs[i] + widths[i] - pad : xs[i] + pad;
            doc.text(m.cells[i], tx, y + 12, c.align === "right" ? { align: "right" } : undefined);
          });
          if (m.sub.length) { font("courier", "normal", 7); text(COLOR.muted); doc.text(m.sub, M + pad, y + m.main + 2); }
          stroke(COLOR.line); doc.setLineWidth(0.5); doc.line(M, y + m.total, W - M, y + m.total);
          y += m.total;
        });
        y += 12;
      }
    };

    (spec.blocks || []).forEach(b => { if (draw[b.type]) draw[b.type](b); });

    // Rodapé em todas as páginas
    const n = doc.getNumberOfPages(), f = spec.footer || {};
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      stroke(COLOR.line); doc.setLineWidth(0.6); doc.line(M, H - 46, W - M, H - 46);
      font("helvetica", "normal", 7.5); text(COLOR.muted);
      doc.text(wrap(f.disclaimer || "", CW - 90, 2), M, H - 35);
      doc.text(safe(String(f.page || "{p}/{n}").replace("{p}", i).replace("{n}", n)), W - M, H - 35, { align: "right" });
      doc.text(safe(f.left || ""), M, H - 15);
    }
    return doc;
  }

  return { build, safe, COLOR };
});
