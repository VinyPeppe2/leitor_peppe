// Rode com: node tests/core.test.js
const assert = require("assert");
const C = require("../core.js");

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("  ✔", name); };

ok("CRC16-CCITT (vetor padrão 123456789 = 29B1)", () => assert.strictEqual(C.crc16("123456789"), "29B1"));

ok("GTIN: EAN-13, UPC-A e EAN-8 válidos / inválidos", () => {
  assert.strictEqual(C.gtinCheck("4006381333931"), true);
  assert.strictEqual(C.gtinCheck("036000291452"), true);
  assert.strictEqual(C.gtinCheck("96385074"), true);
  assert.strictEqual(C.gtinCheck("4006381333932"), false);
  assert.strictEqual(C.gtinCheck("12345"), null);
});

ok("classify: produto, ISBN e numérico", () => {
  assert.strictEqual(C.classify("4006381333931", "EAN_13").kind, "gtin");
  assert.strictEqual(C.classify("9780306406157", "EAN_13").kind, "isbn");
  assert.strictEqual(C.classify("123456", "").kind, "numeric");
  assert.strictEqual(C.classify("7891000100103", "EAN_13").data.brazil, true);
});

ok("Pix: gerar → ler → CRC válido; adulterado → CRC inválido", () => {
  const p = C.buildPix("teste@exemplo.com", "João da Silva & Cia", "São Paulo", "25.9", "PEDIDO123");
  const r = C.parsePix(p);
  assert.ok(r && r.crcOk);
  assert.strictEqual(r.key, "teste@exemplo.com");
  assert.strictEqual(r.name, "JOAO DA SILVA CIA");
  assert.strictEqual(r.city, "SAO PAULO");
  assert.strictEqual(r.amount, "25.90");
  assert.strictEqual(r.txid, "PEDIDO123");
  const bad = p.replace("25.90", "99.90");
  assert.strictEqual(C.parsePix(bad).crcOk, false);
  assert.strictEqual(C.classify(p).kind, "pix");
});

ok("Chave Pix: normalização e tipo", () => {
  assert.strictEqual(C.normalizePixKey("(11) 98765-4321"), "+5511987654321");
  assert.strictEqual(C.normalizePixKey("123.456.789-09"), "12345678909");
  assert.strictEqual(C.normalizePixKey(" Fulano@Mail.com "), "fulano@mail.com");
  assert.strictEqual(C.pixKeyKind("+5511987654321"), "phone");
  assert.strictEqual(C.pixKeyKind("12345678000199"), "cnpj");
  assert.strictEqual(C.pixKeyKind("123e4567-e89b-12d3-a456-426614174000"), "evp");
});

ok("Links: sinais de alerta", () => {
  assert.deepStrictEqual(C.analyzeUrl("https://exemplo.com/a").flags, []);
  assert.ok(C.analyzeUrl("http://exemplo.com").flags.includes("http"));
  assert.ok(C.analyzeUrl("https://192.168.0.1/x").flags.includes("ip"));
  assert.ok(C.analyzeUrl("https://bit.ly/abc").flags.includes("short"));
  assert.ok(C.analyzeUrl("https://xn--pple-43d.com").flags.includes("idn"));
  assert.ok(C.analyzeUrl("https://user:pw@site.com").flags.includes("creds"));
  assert.strictEqual(C.analyzeUrl("javascript:alert(1)"), null);
});

ok("Wi-Fi com escapes", () => {
  const w = C.parseWifi("WIFI:T:WPA;S:Casa\\;Peppe;P:se\\:nha;H:true;;");
  assert.deepStrictEqual(w, { ssid: "Casa;Peppe", password: "se:nha", auth: "WPA", hidden: true });
  assert.strictEqual(C.classify("WIFI:T:WPA;S:x;P:y;;").kind, "wifi");
});

ok("vCard", () => {
  const v = C.parseVcard("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Maria Souza\r\nORG:Peppe;\r\nTEL;TYPE=CELL:+5511999990000\r\nEMAIL:m@x.com\r\nEND:VCARD");
  assert.strictEqual(v.name, "Maria Souza");
  assert.deepStrictEqual(v.phones, ["+5511999990000"]);
  assert.deepStrictEqual(v.emails, ["m@x.com"]);
});

// Monta um boleto válido (código de barras de 44 dígitos e linha digitável de 47)
function makeBarcode(bank, factor, cents, livre25) {
  const sem = bank + "9" + String(factor).padStart(4, "0") + String(cents).padStart(10, "0") + livre25;
  const dv = C.mod11Boleto(sem.slice(0, 4) + sem.slice(4));
  return sem.slice(0, 4) + dv + sem.slice(4);
}
function makeLinha(bar) {
  const c1 = bar.slice(0, 4) + bar.slice(19, 24), c2 = bar.slice(24, 34), c3 = bar.slice(34, 44);
  return c1 + C.mod10(c1) + c2 + C.mod10(c2) + c3 + C.mod10(c3) + bar[4] + bar.slice(5, 19);
}

ok("Boleto: DV mod11, conversão linha→barras, valor e vencimento", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  // fator 1000 + (dias entre 22/02/2025 e 20/12/2026) → ciclo novo
  const days = Math.round((Date.UTC(2026, 11, 20) - Date.UTC(2025, 1, 22)) / 86400000);
  const bar = makeBarcode("237", 1000 + days, 12345, "1234567890123456789012345");
  assert.strictEqual(bar.length, 44);
  const r = C.classify(bar, "ITF", now);
  assert.strictEqual(r.kind, "boleto");
  assert.ok(r.data.dvOk);
  assert.strictEqual(r.data.amount, 123.45);
  assert.strictEqual(r.data.bankName, "Bradesco");
  assert.strictEqual(r.data.due, "2026-12-20");

  const linha = makeLinha(bar);
  assert.strictEqual(linha.length, 47);
  assert.strictEqual(C.linhaToBarcode(linha), bar);
  const l = C.classify(linha.replace(/(\d{5})(\d{5})/, "$1.$2"), "", now);
  assert.strictEqual(l.kind, "boleto");
  assert.ok(l.data.dvOk);
  assert.strictEqual(l.data.barcode, bar);

  const adulterada = linha.slice(0, 20) + (linha[20] === "0" ? "1" : "0") + linha.slice(21);
  assert.strictEqual(C.classify(adulterada, "", now).data.dvOk, false);
});

ok("Convênio (48 dígitos iniciando em 8)", () => {
  assert.strictEqual(C.classify("8" + "1".repeat(47), "").kind, "utility");
});

ok("Pix: entradas que não são Pix", () => {
  assert.strictEqual(C.parsePix("000201abc"), null);
  assert.strictEqual(C.parsePix("https://x.com"), null);
});

ok("Imitação de marca: só domínios oficiais passam", () => {
  assert.strictEqual(C.analyzeUrl("https://www.nubank.com.br/ajuda").brand, null);
  assert.strictEqual(C.analyzeUrl("https://blog.nubank.com.br").brand, null);
  assert.strictEqual(C.analyzeUrl("https://banco.bradesco/").brand, null);
  assert.strictEqual(C.analyzeUrl("https://www.itau.com.br").brand, null);
  assert.strictEqual(C.analyzeUrl("https://nubank-seguro.com/login").brand, "Nubank");
  assert.strictEqual(C.analyzeUrl("https://nubank.com.br.pagamento.xyz").brand, "Nubank");
  assert.strictEqual(C.analyzeUrl("https://itau-atualiza.net").brand, "Itaú");
  assert.strictEqual(C.analyzeUrl("https://santander.com.br.evil.io").brand, "Santander");
  assert.ok(C.analyzeUrl("https://mercadopago-bonus.com").flags.includes("brand"));
  assert.strictEqual(C.analyzeUrl("https://exemplo.com").brand, null);
});

ok("Veredito: Pix, boleto, link, produto", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const pix = C.buildPix("a@b.com", "Maria", "Sao Paulo", "10", "***");
  assert.strictEqual(C.assess(C.classify(pix), now).level, "ok");
  assert.strictEqual(C.assess(C.classify(pix.replace("10.00", "99.00")), now).level, "bad");
  assert.strictEqual(C.assess(C.classify("https://exemplo.com"), now).level, "ok");
  const a = C.assess(C.classify("http://nubank-login.com"), now);
  assert.strictEqual(a.level, "warn");
  assert.ok(a.reasons.some(r => r.key === "flag_brand" && r.params.brand === "Nubank"));
  assert.strictEqual(C.assess(C.classify("4006381333932", "EAN_13"), now).level, "warn"); // EAN com dígito errado
  assert.strictEqual(C.assess(C.classify("texto"), now).level, "info");
  const old = makeBarcode("237", 7000, 5000, "1234567890123456789012345"); // vencido
  const ov = C.assess(C.classify(old, "ITF", now), now);
  assert.strictEqual(ov.level, "warn");
  assert.ok(ov.reasons.some(r => r.key === "r_boleto_expired"));
  const adult = old.slice(0, 20) + (old[20] === "0" ? "1" : "0") + old.slice(21);
  assert.strictEqual(C.assess(C.classify(adult, "ITF", now), now).level, "bad");
});

ok("Boleto: código de barras → linha digitável (ida e volta)", () => {
  const bar = makeBarcode("341", 8000, 9999, "9876543210987654321098765");
  const linha = C.barcodeToLinha(bar);
  assert.strictEqual(linha.length, 47);
  assert.strictEqual(linha, makeLinha(bar));
  assert.strictEqual(C.linhaToBarcode(linha), bar);
  assert.strictEqual(C.barcodeToLinha("123"), "");
});

ok("Bancos: todos com https e domínio sem duplicatas", () => {
  const ids = new Set();
  C.BANK_SITES.forEach(b => { assert.ok(/^https:\/\//.test(b.url)); ids.add(b.id); });
  assert.strictEqual(ids.size, C.BANK_SITES.length);
});

ok("Conteúdo estranho: file://, javascript:, 2FA, cripto, app", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const lv = s => C.assess(C.classify(s), now).level;
  assert.strictEqual(C.classify("file:///C:/Users/ana/foto.png").kind, "file");
  assert.strictEqual(lv("file:///C:/Users/ana/foto.png"), "warn");
  assert.strictEqual(C.classify("javascript:alert(1)").kind, "script");
  assert.strictEqual(lv("javascript:alert(1)"), "bad");
  assert.strictEqual(lv("data:text/html;base64,AAAA"), "bad");
  assert.strictEqual(C.classify("otpauth://totp/Conta?secret=ABC").kind, "otp");
  assert.strictEqual(lv("bitcoin:bc1qxyz?amount=1"), "warn");
  const app = C.classify("whatsapp://send?text=oi");
  assert.strictEqual(app.kind, "applink");
  assert.strictEqual(app.data.scheme, "whatsapp");
  assert.strictEqual(C.classify("https://www.youtube.com/watch?v=8f6sRJ2BRtk&list=RD8f6sRJ2BRtk&start_radio=1").kind, "url");
  assert.strictEqual(lv("https://www.youtube.com/watch?v=8f6sRJ2BRtk&list=RD8f6sRJ2BRtk&start_radio=1"), "ok");
});

ok("Lote: dedupe de boleto (barras x linha) e de GTIN (UPC-A x EAN-13)", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const bar = makeBarcode("237", 8000, 12345, "1234567890123456789012345");
  const linha = makeLinha(bar);
  assert.strictEqual(C.batchKey(bar, "ITF"), C.batchKey(linha, ""));
  assert.strictEqual(C.batchKey("036000291452", "UPC_A"), C.batchKey("0036000291452", "EAN_13"));
  assert.notStrictEqual(C.batchKey("abc", ""), C.batchKey("abcd", ""));
  const b = C.newBatch("teste");
  assert.strictEqual(C.batchAdd(b, bar, "ITF", now).status, "new");
  const r = C.batchAdd(b, linha, "", now);
  assert.strictEqual(r.status, "dup");
  assert.strictEqual(r.item.count, 2);
  assert.strictEqual(Object.keys(b.items).length, 1);
});

ok("Lote: totais, duplicidade, bloqueados fora da soma, unidades", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const b = C.newBatch("Novembro");
  const pix = C.buildPix("a@b.com", "Maria", "Sao Paulo", "25.9", "***");
  const futuro = Math.round((Date.UTC(2026, 11, 20) - Date.UTC(2025, 1, 22)) / 86400000) + 1000;
  const bol = makeBarcode("237", futuro, 12345, "1234567890123456789012345");
  const vencido = makeBarcode("341", 7000, 5000, "9876543210987654321098765");
  C.batchAdd(b, pix, "QR_CODE", now); C.batchAdd(b, pix, "QR_CODE", now);              // Pix lido 2x
  C.batchAdd(b, bol, "ITF", now);
  C.batchAdd(b, vencido, "ITF", now);
  C.batchAdd(b, pix.replace("25.90", "99.90"), "QR_CODE", now);                         // Pix adulterado
  for (let i = 0; i < 3; i++) C.batchAdd(b, "4006381333931", "EAN_13", now);            // 3 unidades
  C.batchAdd(b, "SKU-778", "CODE_128", now);                                            // SKU
  C.batchAdd(b, "https://nubank-x.com", "QR_CODE", now);                                // link suspeito
  const s = C.batchSummary(b, now);
  assert.strictEqual(s.distinct, 7);
  assert.strictEqual(s.reads, 2 + 1 + 1 + 1 + 3 + 1 + 1);
  assert.strictEqual(s.payTotal, Math.round((25.9 + 123.45 + 50) * 100) / 100);       // adulterado fora
  assert.strictEqual(s.payCount, 3);
  assert.strictEqual(s.dups, 1);
  assert.strictEqual(s.bad, 1);
  assert.strictEqual(s.alerts, 3);          // adulterado + boleto vencido + link suspeito
  assert.strictEqual(s.overdue, 1);
  assert.strictEqual(s.nextDue, "2026-12-20");
  assert.strictEqual(s.units, 4);           // 3 EAN + 1 SKU
});

ok("Lote: teto de 500 itens", () => {
  const b = C.newBatch("");
  for (let i = 0; i < C.BATCH_CAP; i++) assert.strictEqual(C.batchAdd(b, "item" + i, "").status, "new");
  assert.strictEqual(C.batchAdd(b, "outro", "").status, "full");
  assert.strictEqual(C.batchAdd(b, "item7", "").status, "dup");
});

ok("CSV: proteção contra injeção de fórmulas e aspas", () => {
  assert.strictEqual(C.csvSafe("=HYPERLINK(\"http://x\")"), "'=HYPERLINK(\"http://x\")");
  assert.strictEqual(C.csvSafe("+5511999990000"), "'+5511999990000");
  assert.strictEqual(C.csvSafe("@cmd"), "'@cmd");
  assert.strictEqual(C.csvSafe("texto normal"), "texto normal");
  assert.strictEqual(C.toCsv([["a\"b", 5, "=1+1"]]), '"a""b";"5";"\'=1+1"');
  const b = C.newBatch("=Lote");
  C.batchAdd(b, "=cmd|' /C calc'!A0", "QR_CODE");
  const csv = C.batchToCsv(b, new Date("2026-11-19T12:00:00Z"));
  assert.ok(csv.split("\r\n")[0].startsWith('"lote";"ordem"'));
  assert.ok(csv.includes("\"'=cmd|"));
  assert.ok(csv.includes("\"'=Lote\""));
});

ok("Inventário: lista esperada (cabeçalho, separadores, aspas, erros, repetidos)", () => {
  const txt = '\ufeffcodigo;quantidade;descricao\n4006381333931;5;Chocolate\n"SKU-778";2;"Parafuso, aço"\n\n7891000100103\nabc;xx\n;3\n036000291452;4;UPC\n0036000291452;1\n';
  const r = C.parseExpected(txt);
  assert.deepStrictEqual(r.items.map(i => [i.code, i.qty]), [["4006381333931", 5], ["SKU-778", 2], ["7891000100103", 1], ["036000291452", 5]]);
  assert.strictEqual(r.items[1].desc, "Parafuso, aço");
  assert.strictEqual(r.merged, 1);                                // UPC-A e EAN-13 do mesmo produto somados
  assert.deepStrictEqual(r.errors, [6, 7]);                       // "abc;xx" e ";3" (linha em branco também conta)
  assert.deepStrictEqual(C.parseExpected("a,3,x\nb,2").items.map(i => i.qty), [3, 2]);
  assert.deepStrictEqual(C.parseExpected("a\t7\tdesc").items[0], { code: "a", qty: 7, desc: "desc" });
  assert.strictEqual(C.parseExpected("Código;Qtd\nx;1").items.length, 1);   // cabeçalho em português
});

ok("Inventário: falta, sobra, não lido, fora da lista, UPC=EAN, SKU sem caixa", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const exp = C.parseExpected("4006381333931;5;Chocolate\nSKU-778;2\n7891000100103;1\n036000291452;3\n96385074;2");
  const b = C.newBatch("inv");
  for (let i = 0; i < 3; i++) C.batchAdd(b, "4006381333931", "EAN_13", now);          // 3 de 5 -> falta
  C.batchAdd(b, "sku-778", "CODE_128", now); C.batchAdd(b, "SKU-778", "CODE_128", now);  // 2 de 2 -> ok (sem caixa)
  C.batchAdd(b, "0036000291452", "EAN_13", now);                                         // lido como EAN-13, esperado como UPC-A
  for (let i = 0; i < 5; i++) C.batchAdd(b, "96385074", "EAN_8", now);                  // 5 de 2 -> sobra
  C.batchAdd(b, "5901234123457", "EAN_13", now);                                         // fora da lista
  C.batchAdd(b, C.buildPix("a@b.com", "Maria", "Sao Paulo", "10", "***"), "QR_CODE", now); // Pix: ignorado
  const rep = C.inventoryReport(b, exp, now), st = Object.fromEntries(rep.rows.map(r => [r.code, r.status]));
  assert.deepStrictEqual(st, { "7891000100103": "unread", "4006381333931": "short", "036000291452": "short", "96385074": "over", "5901234123457": "extra", "SKU-778": "ok" });
  assert.strictEqual(rep.rows[0].status, "unread");                  // divergências primeiro
  assert.strictEqual(rep.rows[rep.rows.length - 1].status, "ok");    // conferidos por último
  const T = rep.totals;
  assert.deepStrictEqual([T.expectedItems, T.expectedUnits, T.ok, T.short, T.over, T.unread, T.extra, T.divergences], [5, 13, 1, 2, 1, 1, 1, 5]);
  assert.strictEqual(T.countedUnits, 3 + 2 + 1 + 2);                 // sobra não conta além do esperado
  assert.strictEqual(T.extraUnits, 1);
  const csv = C.inventoryCsv(rep, "inv");
  assert.ok(csv.startsWith('"lote";"codigo"') && csv.includes('"4006381333931";"Chocolate";"5";"3";"-2";"short"'));
});

ok("Inventário: consulta rápida para a voz durante a leitura", () => {
  const exp = C.parseExpected("4006381333931;3");
  const map = new Map(exp.items.map(i => [C.invKey(i.code), i]));
  assert.deepStrictEqual(C.inventoryLookup(map, 1, "4006381333931"), { status: "short", counted: 1, expected: 3 });
  assert.strictEqual(C.inventoryLookup(map, 3, "4006381333931").status, "ok");
  assert.strictEqual(C.inventoryLookup(map, 4, "4006381333931").status, "over");
  assert.strictEqual(C.inventoryLookup(map, 1, "999").status, "extra");
});

ok("Guia visual: quadro, orientação e cores", () => {
  const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  const b = C.guideBox(sq(100, 100, 200), 1000, 800);
  assert.ok(Math.abs(b.cx - 0.2) < 1e-9 && Math.abs(b.w - 0.2) < 1e-9);
  assert.strictEqual(C.guideBox([], 1000, 800), null);
  assert.strictEqual(C.guideHint(null), "none");
  assert.strictEqual(C.guideHint(C.guideBox(sq(10, 10, 60), 1000, 800)), "closer");
  assert.strictEqual(C.guideHint(b, null), "ok");
  assert.strictEqual(C.guideHint(C.guideBox(sq(400, 100, 200), 1000, 800), b), "hold");
  assert.strictEqual(C.guideLevel(true, false), "ok");
  assert.strictEqual(C.guideLevel(false, true), "bad");
  assert.strictEqual(C.guideLevel(false, false), "pending");
});

ok("Alternância automática: 3 janelas sem leitura trocam o motor", () => {
  const f = C.makeFallback(4000, 3);
  assert.strictEqual(f.seen(0), false);
  assert.strictEqual(f.seen(3000), false);
  assert.strictEqual(f.seen(4000), false);   // falha 1
  assert.strictEqual(f.seen(8000), false);   // falha 2
  assert.strictEqual(f.seen(12000), true);   // falha 3 -> troca
  assert.strictEqual(f.switched, true);
  const g = C.makeFallback(4000, 3);
  g.seen(0); g.seen(4000); g.seen(8000);
  g.read();                                   // motor principal leu: zera
  assert.strictEqual(g.fails, 0);
  g.seen(9000); g.lost(); g.seen(20000);      // código saiu da vista: reinicia a janela
  assert.strictEqual(g.switched, false);
});

console.log(`\n${n} grupos de testes passaram.`);
