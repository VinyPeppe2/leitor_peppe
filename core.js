/*
 * Leitor QR - Peppe · core.js
 * Lógica pura (sem DOM): Pix, boleto, GTIN/EAN/ISBN, Wi-Fi, vCard, análise de links.
 * Funciona no navegador (window.PeppeCore) e no Node (tests/core.test.js).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PeppeCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- Formatos de leitura ---------- */
  const F1D = ["CODABAR", "CODE_39", "CODE_93", "CODE_128", "EAN_8", "EAN_13", "ITF", "RSS_14", "RSS_EXPANDED", "UPC_A", "UPC_E"];
  const F2D = ["QR_CODE", "AZTEC", "DATA_MATRIX", "PDF_417"];

  const FORMAT_LABELS = {
    QR_CODE: "QR Code", EAN_13: "EAN-13", EAN_8: "EAN-8", UPC_A: "UPC-A", UPC_E: "UPC-E",
    CODE_128: "Code 128", CODE_39: "Code 39", CODE_93: "Code 93", ITF: "ITF (2 de 5)",
    CODABAR: "Codabar", DATA_MATRIX: "Data Matrix", PDF_417: "PDF417", AZTEC: "Aztec",
    RSS_14: "GS1 DataBar", RSS_EXPANDED: "GS1 DataBar Exp."
  };
  function formatLabel(fmt) {
    if (!fmt) return "";
    const k = String(fmt).toUpperCase();
    return FORMAT_LABELS[k] || String(fmt).replace(/_/g, " ");
  }

  /* ---------- Utilidades ---------- */
  const stripAccents = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");

  function crc16(s) {
    let crc = 0xFFFF;
    const bytes = new TextEncoder().encode(s);
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
  }

  /* ---------- Pix ---------- */
  function tlv(id, v) {
    v = String(v);
    const length = new TextEncoder().encode(v).length;
    if (length > 99) throw new Error("Campo Pix muito longo: " + id);
    return id + String(length).padStart(2, "0") + v;
  }

  function parseTLV(s) {
    const o = {};
    let i = 0;
    s = String(s || "");
    while (i + 4 <= s.length) {
      const id = s.slice(i, i + 2);
      const n = parseInt(s.slice(i + 2, i + 4), 10);
      if (!Number.isFinite(n) || n < 0 || i + 4 + n > s.length) break;
      o[id] = s.slice(i + 4, i + 4 + n);
      i += 4 + n;
    }
    return o;
  }

  function sanitizePixText(s, max) {
    return stripAccents(s).replace(/[^0-9A-Za-z .\-]/g, "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, max);
  }

  function normalizePixKey(raw) {
    let k = String(raw || "").trim();
    if (!k) return "";
    if (k.includes("@")) return k.toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase();
    if (k.startsWith("+")) return "+" + k.replace(/\D/g, "");
    if (/^[\d.\-\/\s()]+$/.test(k)) {
      const d = k.replace(/\D/g, "");
      if (/[()]/.test(k) || (d.length === 10)) return "+55" + d.replace(/^55(?=\d{10,11}$)/, "");
      return d;
    }
    return k;
  }

  function pixKeyKind(key) {
    const k = String(key || "").trim();
    if (!k) return "";
    if (k.includes("@")) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k) ? "email" : "unknown";
    if (/^\+\d{10,15}$/.test(k)) return "phone";
    if (/^\d{14}$/.test(k)) return "cnpj";
    if (/^\d{11}$/.test(k)) return "cpf_phone";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return "evp";
    return "unknown";
  }

  function buildPix(key, name, city, amount, txid) {
    const merchant = tlv("00", "br.gov.bcb.pix") + tlv("01", key);
    let body = tlv("00", "01") + tlv("01", "11") + tlv("26", merchant) + tlv("52", "0000") + tlv("53", "986");
    if (amount) body += tlv("54", Number(amount).toFixed(2));
    body += tlv("58", "BR") + tlv("59", sanitizePixText(name, 25)) + tlv("60", sanitizePixText(city, 15)) + tlv("62", tlv("05", txid || "***"));
    const p = body + "6304";
    return p + crc16(p);
  }

  function checkPixCrc(s) {
    s = String(s).trim();
    return s.length > 8 && s.slice(-8, -4) === "6304" && crc16(s.slice(0, -4)) === s.slice(-4).toUpperCase();
  }

  function parsePix(s) {
    s = String(s || "").trim();
    if (!/^000201/.test(s)) return null;
    const root = parseTLV(s);
    const m = parseTLV(root["26"] || "");
    if (!String(m["00"] || "").toLowerCase().includes("br.gov.bcb.pix")) return null;
    const add = parseTLV(root["62"] || "");
    return {
      key: m["01"] || "",
      url: m["25"] || "",
      dynamic: !!m["25"] && !m["01"],
      name: root["59"] || "",
      city: root["60"] || "",
      amount: root["54"] || "",
      txid: add["05"] || "",
      crcOk: checkPixCrc(s)
    };
  }

  /* ---------- Links ---------- */
  const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rebrand.ly", "shorturl.at", "tiny.cc", "rb.gy", "t.ly", "qrco.de", "l.ead.me"];

  // Domínios oficiais conferidos em pesquisa. Marcas citadas em um endereço que NÃO termine
  // em um destes domínios geram alerta de possível imitação (nível "atenção": existem
  // sites legítimos de grupos, como cartões e seguros, que não estão nesta lista).
  const BRANDS = [
    { key: "nubank", name: "Nubank", domains: ["nubank.com.br"] },
    { key: "itau", name: "Itaú", domains: ["itau.com.br"] },
    { key: "bradesco", name: "Bradesco", domains: ["bradesco.com.br", "banco.bradesco", "bradesco"] },
    { key: "santander", name: "Santander", domains: ["santander.com.br"] },
    { key: "bancodobrasil", name: "Banco do Brasil", domains: ["bb.com.br"] },
    { key: "c6bank", name: "C6 Bank", domains: ["c6bank.com.br"] },
    { key: "bancointer", name: "Inter", domains: ["inter.co", "bancointer.com.br"] },
    { key: "mercadopago", name: "Mercado Pago", domains: ["mercadopago.com.br", "mercadopago.com"] },
    { key: "pagbank", name: "PagBank", domains: ["pagbank.com.br"] },
    { key: "picpay", name: "PicPay", domains: ["picpay.com"] },
    { key: "caixa.gov", name: "Caixa", domains: ["caixa.gov.br"] }
  ];
  const isOfficial = (host, doms) => doms.some(d => host === d || host.endsWith("." + d));

  function brandCheck(host) {
    host = String(host).toLowerCase().replace(/^www\./, "");
    for (const b of BRANDS) {
      if (host.includes(b.key) && !isOfficial(host, b.domains)) return b.name;
    }
    return null;
  }

  function analyzeUrl(s) {
    let u;
    try { u = new URL(String(s).trim()); } catch { return null; }
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    const flags = [];
    if (u.protocol === "http:") flags.push("http");
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) flags.push("ip");
    if (host.startsWith("xn--") || host.includes(".xn--")) flags.push("idn");
    if (SHORTENERS.includes(host.replace(/^www\./, ""))) flags.push("short");
    if (u.username || u.password) flags.push("creds");
    if (host.split(".").length > 5) flags.push("subdomains");
    const brand = brandCheck(host);
    if (brand) flags.push("brand");
    return { host, protocol: u.protocol, flags, brand, url: u.href };
  }

  /* ---------- Wi-Fi e vCard ---------- */
  function splitKeep(str, sep) {
    const parts = [];
    let cur = "";
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === "\\" && i + 1 < str.length) { cur += c + str[i + 1]; i++; }
      else if (c === sep) { parts.push(cur); cur = ""; }
      else cur += c;
    }
    parts.push(cur);
    return parts;
  }
  const unesc = v => String(v).replace(/\\([\\;,:"])/g, "$1");

  function parseWifi(s) {
    if (!/^WIFI:/i.test(s)) return null;
    const out = {};
    splitKeep(String(s).slice(5), ";").forEach(part => {
      const i = part.indexOf(":");
      if (i > 0) out[part.slice(0, i).toUpperCase()] = unesc(part.slice(i + 1));
    });
    if (!("S" in out)) return null;
    return { ssid: out.S || "", password: out.P || "", auth: out.T || "", hidden: /^true$/i.test(out.H || "") };
  }

  function parseVcard(s) {
    const text = String(s).replace(/\r?\n[ \t]/g, "");
    const r = { name: "", org: "", phones: [], emails: [], url: "" };
    text.split(/\r?\n/).forEach(line => {
      const i = line.indexOf(":");
      if (i < 0) return;
      const prop = line.slice(0, i).split(";")[0].toUpperCase();
      const val = line.slice(i + 1).trim();
      if (prop === "FN") r.name = val;
      else if (prop === "N" && !r.name) r.name = val.split(";").filter(Boolean).reverse().join(" ");
      else if (prop === "ORG") r.org = val.replace(/;/g, " ").trim();
      else if (prop === "TEL") r.phones.push(val);
      else if (prop === "EMAIL") r.emails.push(val);
      else if (prop === "URL" && !r.url) r.url = val;
    });
    return r;
  }

  /* ---------- GTIN / EAN / UPC / ISBN ---------- */
  function gtinCheck(s) {
    s = String(s);
    if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return null;
    const d = s.split("").map(Number);
    const chk = d.pop();
    let sum = 0;
    for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w;
    return (10 - (sum % 10)) % 10 === chk;
  }
  const gtinKind = s => ({ 8: "EAN-8", 12: "UPC-A", 13: "EAN-13", 14: "GTIN-14" }[String(s).length] || "");

  /* ---------- Boleto, convênio e NF-e (Brasil) ---------- */
  const BANKS = {
    "001": "Banco do Brasil", "033": "Santander", "104": "Caixa", "237": "Bradesco", "341": "Itaú",
    "260": "Nubank", "077": "Inter", "336": "C6 Bank", "212": "Original", "422": "Safra",
    "756": "Sicoob", "748": "Sicredi", "380": "PicPay", "290": "PagBank", "208": "BTG Pactual",
    "623": "Pan", "655": "Votorantim", "070": "BRB", "085": "Ailos", "004": "Banco do Nordeste",
    "003": "Banco da Amazônia", "041": "Banrisul", "197": "Stone", "403": "Cora", "301": "BPP"
  };

  function mod11Boleto(num43) {
    let sum = 0, w = 2;
    for (let i = num43.length - 1; i >= 0; i--) { sum += Number(num43[i]) * w; w = w === 9 ? 2 : w + 1; }
    const dv = 11 - (sum % 11);
    return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
  }
  function mod10(str) {
    let sum = 0, w = 2;
    for (let i = str.length - 1; i >= 0; i--) {
      let p = Number(str[i]) * w;
      if (p > 9) p = Math.floor(p / 10) + (p % 10);
      sum += p;
      w = w === 2 ? 1 : 2;
    }
    return (10 - (sum % 10)) % 10;
  }
  const linhaToBarcode = l => l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);

  function barcodeToLinha(bar) {
    bar = String(bar);
    if (!/^\d{44}$/.test(bar)) return "";
    const c1 = bar.slice(0, 4) + bar.slice(19, 24), c2 = bar.slice(24, 34), c3 = bar.slice(34, 44);
    return c1 + mod10(c1) + c2 + mod10(c2) + c3 + mod10(c3) + bar[4] + bar.slice(5, 19);
  }

  // Fator de vencimento: base 07/10/1997; reinicia em 1000 a partir de 22/02/2025.
  function dueDate(factor, now) {
    if (!factor) return null;
    const DAY = 86400000;
    const base = Date.UTC(1997, 9, 7);
    const a = base + factor * DAY;
    const b = a + 9000 * DAY;
    const ref = (now instanceof Date ? now : new Date()).getTime();
    const pick = Math.abs(a - ref) <= Math.abs(b - ref) ? a : b;
    return new Date(pick).toISOString().slice(0, 10);
  }

  function nfeValid(d) {
    if (!/^\d{44}$/.test(d)) return false;
    const uf = Number(d.slice(0, 2));
    const ufs = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 35, 41, 42, 43, 50, 51, 52, 53];
    if (!ufs.includes(uf)) return false;
    if (!["55", "65", "57", "58", "59", "63", "67"].includes(d.slice(20, 22))) return false;
    let sum = 0, w = 2;
    for (let i = 42; i >= 0; i--) { sum += Number(d[i]) * w; w = w === 9 ? 2 : w + 1; }
    const r = sum % 11;
    return (r < 2 ? 0 : 11 - r) === Number(d[43]);
  }

  function boletoFrom(bar, source, extraOk, now) {
    const dvOk = mod11Boleto(bar.slice(0, 4) + bar.slice(5)) === Number(bar[4]) && extraOk !== false;
    const factor = Number(bar.slice(5, 9));
    const cents = Number(bar.slice(9, 19));
    return {
      kind: "boleto",
      data: {
        source, dvOk, bank: bar.slice(0, 3), bankName: BANKS[bar.slice(0, 3)] || "",
        factor, due: dueDate(factor, now), amount: cents / 100, barcode: bar
      }
    };
  }

  function parseBoleto(digits, fmt, now) {
    const f = String(fmt || "").toUpperCase();
    const d = String(digits);
    if (!/^\d+$/.test(d)) return null;
    if ((d.length === 44 || d.length === 48) && d[0] === "8") return { kind: "utility", data: { length: d.length } };
    if (d.length === 47 && d[0] !== "8") {
      const fieldsOk = mod10(d.slice(0, 9)) === Number(d[9]) && mod10(d.slice(10, 20)) === Number(d[20]) && mod10(d.slice(21, 31)) === Number(d[31]);
      return boletoFrom(linhaToBarcode(d), "line", fieldsOk, now);
    }
    if (d.length === 44 && d[0] !== "8") {
      const bol = boletoFrom(d, "barcode", true, now);
      const nfe = nfeValid(d);
      if (/ITF/.test(f)) return bol;
      if (/CODE_128/.test(f)) return nfe ? { kind: "nfe", data: { dvOk: true } } : null;
      if (nfe && !bol.data.dvOk) return { kind: "nfe", data: { dvOk: true } };
      if (bol.data.dvOk) return bol;
    }
    return null;
  }

  /* ---------- Classificação geral ---------- */
  function classify(s, fmt, now) {
    const t = String(s == null ? "" : s).trim();
    const f = String(fmt || "").toUpperCase();
    if (!t) return { kind: "text", data: {} };

    const pix = parsePix(t);
    if (pix) return { kind: "pix", data: pix };

    const url = /^https?:\/\//i.test(t) ? analyzeUrl(t) : null;
    if (url) return { kind: "url", data: url };

    if (/^WIFI:/i.test(t)) { const w = parseWifi(t); if (w) return { kind: "wifi", data: w }; }
    if (/^BEGIN:VCARD/i.test(t)) return { kind: "vcard", data: parseVcard(t) };
    if (/^BEGIN:(VEVENT|VCALENDAR)/i.test(t)) return { kind: "event", data: {} };
    if (/^mailto:/i.test(t)) return { kind: "email", data: { address: t.slice(7).split("?")[0] } };
    if (/^tel:/i.test(t)) return { kind: "phone", data: { number: t.slice(4) } };
    if (/^smsto?:/i.test(t)) return { kind: "sms", data: {} };
    if (/^geo:/i.test(t)) return { kind: "geo", data: {} };
    if (/^file:/i.test(t)) return { kind: "file", data: {} };
    if (/^(javascript|vbscript|data):/i.test(t)) return { kind: "script", data: {} };
    if (/^otpauth(-migration)?:/i.test(t)) return { kind: "otp", data: {} };
    if (/^(bitcoin|ethereum|litecoin|lightning|monero|solana):/i.test(t)) return { kind: "crypto", data: {} };
    if (/^[a-z][a-z0-9+.\-]{1,30}:\/\//i.test(t)) return { kind: "applink", data: { scheme: t.split(":")[0].toLowerCase() } };

    const digits = t.replace(/[\s.\-]/g, "");
    if (/^\d+$/.test(digits) && digits.length >= 44) {
      const b = parseBoleto(digits, f, now);
      if (b) return b;
    }

    if (/^\d+$/.test(t)) {
      const g = gtinCheck(t);
      if (g !== null && (g === true || /EAN|UPC/.test(f))) {
        const isbn = t.length === 13 && /^97[89]/.test(t) && g === true;
        return {
          kind: isbn ? "isbn" : "gtin",
          data: { type: gtinKind(t), valid: g, brazil: t.length === 13 && /^(789|790)/.test(t) }
        };
      }
      return { kind: "numeric", data: {} };
    }
    return { kind: "text", data: {} };
  }

  /* ---------- Veredito de confiança ---------- */
  const RANK = { info: 0, ok: 1, warn: 2, bad: 3 };
  function assess(info, now) {
    let level = "info";
    const reasons = [];
    const add = (lv, key, params) => { reasons.push({ key, params: params || {}, level: lv }); if (RANK[lv] > RANK[level]) level = lv; };
    const today = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    const d = info.data || {};
    switch (info.kind) {
      case "pix":
        if (!d.crcOk) add("bad", "r_pix_crc_bad");
        else {
          if (!d.name) add("warn", "r_pix_noname");
          if (!d.dynamic && !d.key) add("warn", "r_pix_nokey");
          if (level !== "warn") add("ok", "r_pix_ok");
        }
        break;
      case "boleto":
        if (!d.dvOk) add("bad", "r_boleto_dv_bad");
        else {
          if (d.due && d.due < today) add("warn", "r_boleto_expired", { d: d.due });
          if (level !== "warn") add("ok", "r_boleto_ok");
        }
        break;
      case "url":
        d.flags.forEach(f => add("warn", "flag_" + (f === "subdomains" ? "sub" : f), { brand: d.brand || "" }));
        if (!d.flags.length) add("ok", "r_url_ok");
        break;
      case "gtin": case "isbn":
        if (d.valid === false) add("warn", "r_gtin_bad");
        break;
      case "file": add("warn", "r_file"); break;
      case "script": add("bad", "r_script"); break;
      case "applink": add("warn", "r_applink", { scheme: d.scheme }); break;
      case "otp": add("warn", "r_otp"); break;
      case "crypto": add("warn", "r_crypto"); break;
      default: break;
    }
    return { level, reasons };
  }

  // Sites oficiais para o "Copiar e abrir meu banco" (nunca recebem dados do app).
  const BANK_SITES = [
    { id: "nubank", name: "Nubank", url: "https://nubank.com.br" },
    { id: "itau", name: "Itaú", url: "https://www.itau.com.br" },
    { id: "bradesco", name: "Bradesco", url: "https://banco.bradesco" },
    { id: "bb", name: "Banco do Brasil", url: "https://www.bb.com.br" },
    { id: "caixa", name: "Caixa", url: "https://www.caixa.gov.br" },
    { id: "santander", name: "Santander", url: "https://www.santander.com.br" },
    { id: "inter", name: "Inter", url: "https://inter.co" },
    { id: "c6", name: "C6 Bank", url: "https://www.c6bank.com.br" },
    { id: "mercadopago", name: "Mercado Pago", url: "https://www.mercadopago.com.br" },
    { id: "pagbank", name: "PagBank", url: "https://pagbank.com.br" }
  ];

  /* ---------- Lote (leitura em sequência) ---------- */
  const BATCH_CAP = 500;

  // Chave de deduplicação: o mesmo boleto lido em barras (44) e em linha digitável (47)
  // e o mesmo produto em UPC-A/EAN-13 viram UM item.
  function batchKey(value, fmt) {
    const v = String(value == null ? "" : value).trim();
    const info = classify(v, fmt);
    if (info.kind === "boleto") return "boleto:" + info.data.barcode;
    if (info.kind === "gtin" || info.kind === "isbn") return "gtin:" + v.padStart(14, "0");
    return "raw:" + v;
  }
  function newBatch(name) { return { name: name || "", items: {}, seq: 0 }; }
  function batchAdd(batch, value, fmt, now) {
    const key = batchKey(value, fmt);
    const ts = (now instanceof Date ? now : new Date()).toISOString();
    const it = batch.items[key];
    if (it) { it.count++; it.last = ts; return { status: "dup", key, item: it }; }
    if (Object.keys(batch.items).length >= BATCH_CAP) return { status: "full", key };
    batch.seq = (batch.seq || 0) + 1;
    const item = { value: String(value).trim(), format: fmt || "", count: 1, seq: batch.seq, first: ts, last: ts };
    batch.items[key] = item;
    return { status: "new", key, item };
  }
  function batchRows(batch, now) {
    return Object.keys(batch.items).map(key => {
      const item = batch.items[key], info = classify(item.value, item.format, now);
      return { key, item, info, a: assess(info, now) };
    }).sort((x, y) => x.item.seq - y.item.seq);
  }
  const isProduct = row => row.info.kind === "gtin" || row.info.kind === "isbn" ||
    (F1D.includes(String(row.item.format).toUpperCase()) && (row.info.kind === "numeric" || row.info.kind === "text"));
  const isPay = row => row.info.kind === "boleto" || row.info.kind === "pix" || row.info.kind === "utility";

  function batchSummary(batch, now) {
    const rows = batchRows(batch, now);
    const today = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
    const r = { distinct: rows.length, reads: 0, alerts: 0, bad: 0, dups: 0, payTotal: 0, payCount: 0, units: 0, nextDue: null, overdue: 0 };
    rows.forEach(row => {
      const { item, info, a } = row, d = info.data;
      r.reads += item.count;
      if (a.level === "warn" || a.level === "bad") r.alerts++;
      if (a.level === "bad") { r.bad++; return; }          // bloqueados ficam fora dos totais
      if (isProduct(row)) r.units += item.count;
      if (info.kind === "boleto") {
        r.payTotal += d.amount; r.payCount++;
        if (item.count > 1) r.dups++;
        if (d.due) { if (d.due < today) r.overdue++; else if (!r.nextDue || d.due < r.nextDue) r.nextDue = d.due; }
      } else if (info.kind === "pix") {
        const amt = Number(d.amount) || 0;
        if (amt > 0) { r.payTotal += amt; r.payCount++; }
        if (item.count > 1) r.dups++;
      }
    });
    r.payTotal = Math.round(r.payTotal * 100) / 100;
    return r;
  }

  // CSV: células que começam com = + - @ viram texto (evita injeção de fórmulas no Excel/Planilhas).
  function csvSafe(v) { const s = String(v == null ? "" : v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }
  function toCsv(rows, sep) {
    sep = sep || ";";
    return rows.map(r => r.map(v => '"' + (typeof v === "number" ? String(v) : csvSafe(v)).replace(/"/g, '""') + '"').join(sep)).join("\r\n");
  }
  function batchToCsv(batch, now) {
    const rows = [["lote", "ordem", "tipo", "formato", "quantidade", "conteudo", "valor", "vencimento", "veredito", "primeira_leitura", "ultima_leitura"]];
    batchRows(batch, now).forEach((row, i) => {
      const d = row.info.data;
      const valor = row.info.kind === "boleto" ? d.amount : row.info.kind === "pix" && d.amount ? Number(d.amount) : "";
      rows.push([batch.name || "", i + 1, row.info.kind, row.item.format, row.item.count, row.item.value,
        valor === "" ? "" : String(valor).replace(".", ","), row.info.kind === "boleto" ? (d.due || "") : "", row.a.level, row.item.first, row.item.last]);
    });
    return toCsv(rows);
  }

  /* ---------- Inventário (lista esperada x lote) ---------- */
  const INV_CAP = 2000;

  // Mesma chave dos dois lados: UPC-A, EAN-13 e GTIN-14 numéricos se equivalem; texto (SKU) ignora maiúsculas.
  function invKey(code) {
    const v = String(code == null ? "" : code).trim();
    return /^\d{8,14}$/.test(v) ? "gtin:" + v.padStart(14, "0") : "raw:" + v.toUpperCase();
  }
  function splitDelimited(line, sep) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === sep) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map(x => x.trim());
  }
  // Aceita "codigo;quantidade;descricao" (separador ; , ou tab), com ou sem cabeçalho.
  function parseExpected(text) {
    const lines = String(text == null ? "" : text).replace(/^\ufeff/, "").split(/\r?\n/);
    const map = new Map(), res = { items: [], errors: [], merged: 0, truncated: false };
    let firstSeen = false;
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line) return;
      const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
      const f = splitDelimited(line, sep);
      if (!firstSeen) {
        firstSeen = true;
        if (/^(c[oó]digo|code|ean|gtin|sku|barcode|item|produto)$/i.test(f[0])) return;   // cabeçalho
      }
      const code = f[0];
      if (!code) { res.errors.push(idx + 1); return; }
      let qty = 1;
      if (f.length > 1 && f[1] !== "") {
        if (!/^\d{1,6}$/.test(f[1])) { res.errors.push(idx + 1); return; }
        qty = Number(f[1]);
      }
      const desc = f.slice(2).join(" ").trim().slice(0, 80);
      const k = invKey(code), cur = map.get(k);
      if (cur) { cur.qty += qty; res.merged++; if (!cur.desc && desc) cur.desc = desc; return; }
      if (map.size >= INV_CAP) { res.truncated = true; return; }
      const item = { code, qty, desc };
      map.set(k, item); res.items.push(item);
    });
    return res;
  }

  const INV_KINDS = ["gtin", "isbn", "numeric", "text"];
  const INV_ORDER = { unread: 0, short: 1, over: 2, extra: 3, ok: 4 };
  function inventoryReport(batch, expected, now) {
    const counted = new Map();
    batchRows(batch, now).forEach(r => {
      if (!INV_KINDS.includes(r.info.kind)) return;       // boletos, links etc. não entram no inventário
      const k = invKey(r.item.value), c = counted.get(k) || { count: 0, first: r.item.value };
      c.count += r.item.count; counted.set(k, c);
    });
    const rows = [], seen = new Set();
    (expected && expected.items || []).forEach((e, i) => {
      const k = invKey(e.code); seen.add(k);
      const c = (counted.get(k) || { count: 0 }).count, diff = c - e.qty;
      rows.push({ code: e.code, desc: e.desc || "", expected: e.qty, counted: c, diff, status: c === 0 ? "unread" : diff === 0 ? "ok" : diff < 0 ? "short" : "over", order: i });
    });
    let n = rows.length;
    counted.forEach((c, k) => { if (!seen.has(k)) rows.push({ code: c.first, desc: "", expected: 0, counted: c.count, diff: c.count, status: "extra", order: n++ }); });
    rows.sort((a, b) => INV_ORDER[a.status] - INV_ORDER[b.status] || a.order - b.order);
    const tot = { expectedItems: 0, expectedUnits: 0, countedUnits: 0, ok: 0, short: 0, over: 0, unread: 0, extra: 0, extraUnits: 0 };
    rows.forEach(r => {
      tot[r.status]++;
      if (r.status === "extra") tot.extraUnits += r.counted;
      else { tot.expectedItems++; tot.expectedUnits += r.expected; tot.countedUnits += Math.min(r.counted, r.expected); }
    });
    tot.divergences = tot.short + tot.over + tot.unread + tot.extra;
    return { rows, totals: tot };
  }
  // Estado de UM código durante a leitura (para a voz): {status, counted, expected}
  function inventoryLookup(expectedMap, batchCount, value) {
    const e = expectedMap.get(invKey(value));
    if (!e) return { status: "extra", counted: batchCount, expected: 0 };
    return { status: batchCount === e.qty ? "ok" : batchCount < e.qty ? "short" : "over", counted: batchCount, expected: e.qty };
  }
  function inventoryCsv(report, batchName) {
    const rows = [["lote", "codigo", "descricao", "esperado", "contado", "diferenca", "situacao"]];
    report.rows.forEach(r => rows.push([batchName || "", r.code, r.desc, r.expected, r.counted, r.diff, r.status]));
    return toCsv(rows);
  }


  /* ---------- Guia visual e alternância automática de motor de leitura ---------- */
  // Quadro do código a partir dos cantos (px do vídeo): área relativa, centro e largura.
  function guideBox(points, vw, vh) {
    if (!points || points.length < 3 || !vw || !vh) return null;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { cx: (minX + maxX) / 2 / vw, cy: (minY + maxY) / 2 / vh, w: (maxX - minX) / vw, h: (maxY - minY) / vh, area: ((maxX - minX) * (maxY - minY)) / (vw * vh) };
  }
  // Orientação em texto: "none" | "closer" | "hold" | "ok"
  function guideHint(box, prev) {
    if (!box) return "none";
    if (Math.max(box.w, box.h) < 0.14) return "closer";
    if (prev && Math.hypot(box.cx - prev.cx, box.cy - prev.cy) > 0.07) return "hold";
    return "ok";
  }
  // Cor do ponto: "ok" já lido no lote, "bad" fora da lista esperada, "pending" ainda não lido
  function guideLevel(inBatch, unexpected) { return unexpected ? "bad" : inBatch ? "ok" : "pending"; }
  // Contador de tentativas: cada janela de windowMs com código à vista e nenhuma leitura do motor principal é 1 falha.
  function makeFallback(windowMs, limit) {
    windowMs = windowMs || 4000; limit = limit || 3;
    let start = null, fails = 0, switched = false;
    return {
      read() { start = null; fails = 0; },
      seen(now) {
        if (switched) return false;
        if (start === null) { start = now; return false; }
        if (now - start >= windowMs) { fails++; start = now; if (fails >= limit) { switched = true; return true; } }
        return false;
      },
      lost() { start = null; },
      get fails() { return fails; }, get switched() { return switched; },
      reset() { start = null; fails = 0; switched = false; }
    };
  }

  return {
    F1D, F2D, FORMAT_LABELS, formatLabel, stripAccents, crc16, tlv, parseTLV,
    sanitizePixText, normalizePixKey, pixKeyKind, buildPix, checkPixCrc, parsePix,
    INV_CAP, INV_KINDS, invKey, splitDelimited, parseExpected, inventoryReport, inventoryLookup, inventoryCsv,
    BATCH_CAP, batchKey, newBatch, batchAdd, batchRows, batchSummary, isProduct, isPay, csvSafe, toCsv, batchToCsv,
    SHORTENERS, BRANDS, brandCheck, analyzeUrl, assess, BANK_SITES, barcodeToLinha, parseWifi, parseVcard, gtinCheck, gtinKind,
    guideBox, guideHint, guideLevel, makeFallback,
    BANKS, mod11Boleto, mod10, linhaToBarcode, dueDate, nfeValid, parseBoleto, classify
  };
});
