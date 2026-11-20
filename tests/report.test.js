// Rode com: npm install && npm run test:pdf   (gera tests/out/exemplo.pdf para conferência visual)
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { jsPDF } = require("jspdf");
const R = require("../report.js");

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("  ✔", name); };

ok("safe(): mantém acentos Latin-1 e troca o que as fontes do PDF não cobrem", () => {
  assert.strictEqual(R.safe("Ação — total “R$ 10”…"), 'Ação - total "R$ 10"...');
  assert.strictEqual(R.safe("a b\nc"), "a b c");
  assert.strictEqual(R.safe("emoji 😀 ok"), "emoji ?? ok");
  assert.strictEqual(R.safe(null), "");
});

const long = "00020101021126480014br.gov.bcb.pix0126maria.silva@exemplo.com.br5204000053039865406125.905802BR5911MARIA SILVA6009SAO PAULO62070503***6304ABCD".repeat(2);
const payRows = [];
for (let i = 1; i <= 30; i++) payRows.push({ cells: [String(i), i % 2 ? "Pix" : "Boleto bancário", "Itaú · Conceição Araújo", "R$ " + (i * 12.5).toFixed(2).replace(".", ","), "20/12/2026", i % 7 === 0 ? "Bloqueado" : i % 3 === 0 ? "Atenção" : "OK", String(1 + (i % 3))], level: i % 7 === 0 ? "bad" : i % 3 === 0 ? "warn" : "ok", sub: long });
const spec = {
  meta: { title: "Relatório de lote", subject: "teste" },
  footer: { left: "Leitor QR - Peppe", disclaimer: "Relatório informativo gerado no aparelho. A validação de Pix e boleto é automática e não substitui a conferência no app do banco.", page: "Página {p} de {n}" },
  blocks: [
    { type: "title", title: "Relatório de lote", subtitle: "Lote: Boletos e estoque de novembro - corredor 3 (conferência completa do mês)", meta: "Gerado em 20/11/2026 06:10" },
    { type: "heading", text: "Resumo" },
    { type: "kv", items: [{ label: "Itens", value: "30" }, { label: "Leituras", value: "41" }, { label: "Total a pagar (24)", value: "R$ 11.512,50" }, { label: "Unidades de produtos", value: "12" }, { label: "Com alerta", value: "14" }, { label: "Próximo vencimento", value: "20/12/2026" }] },
    { type: "callout", level: "warn", text: "2 cobrança(s) lida(s) mais de uma vez: risco de pagar em duplicidade." },
    { type: "callout", level: "bad", text: "4 item(ns) com bloqueio (não pague / não continue). Ficam fora dos totais." },
    { type: "heading", text: "Pagamentos (boletos e Pix)" },
    { type: "table", cols: [{ title: "#", w: .06 }, { title: "Tipo", w: .16 }, { title: "Banco / recebedor", w: .27 }, { title: "Valor", w: .15, align: "right" }, { title: "Vencimento", w: .13 }, { title: "Situação", w: .15, level: true }, { title: "Qtd", w: .08, align: "right" }], rows: payRows },
    { type: "heading", text: "Conferência de inventário" },
    { type: "table", cols: [{ title: "Código", w: .3, mono: true }, { title: "Descrição", w: .3 }, { title: "Esperado", w: .13, align: "right" }, { title: "Contado", w: .13, align: "right" }, { title: "Situação", w: .14, level: true }], rows: [{ cells: ["4006381333931", "Chocolate ao leite 90 g", "5", "3", "Falta (-2)"], level: "warn" }, { cells: ["SKU-778", "Parafuso sextavado", "2", "2", "Conferido"], level: "ok" }] },
    { type: "table", cols: [{ title: "x", w: 1 }], rows: [], empty: "Sem itens nesta seção." },
    { type: "note", text: "Fim do relatório." }
  ]
};

let pdf;
ok("Gera PDF válido com várias páginas, rodapé e metadados", () => {
  const doc = R.build(jsPDF, spec);
  pdf = Buffer.from(doc.output("arraybuffer"));
  assert.strictEqual(pdf.slice(0, 5).toString(), "%PDF-");
  assert.ok(doc.getNumberOfPages() >= 3, "páginas: " + doc.getNumberOfPages());
  assert.ok(pdf.length > 5000);
  fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "out", "exemplo.pdf"), pdf);
});

ok("Relatório vazio e sem tabelas não quebra", () => {
  const doc = R.build(jsPDF, { blocks: [{ type: "title", title: "Só título", subtitle: "x", meta: "y" }, { type: "table", cols: [{ title: "a", w: 1 }], rows: [], empty: "vazio" }] });
  assert.strictEqual(doc.getNumberOfPages(), 1);
});

console.log(`\n${n} grupos de testes passaram.`);
