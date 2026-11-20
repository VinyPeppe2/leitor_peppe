/* Leitor QR - Peppe · app.js — interface, câmera, voz e armazenamento local */
(() => {
"use strict";
const C = window.PeppeCore, I = window.PeppeI18n;
const $ = id => document.getElementById(id);
const LANGTAG = { pt: "pt-BR", en: "en-US", es: "es-ES" };

/* ================= Armazenamento ================= */
const rawGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const rawSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const jget = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

const DEFAULTS = { bank: "", batchMode: false, voice: true, rate: 1, beep: true, vibrate: true, autoOpen: false, autoLookup: false, guide: true, mode: "all", continuous: false, voices: {} };
let settings = Object.assign({}, DEFAULTS, jget("peppe-settings", {}));
if (!settings.voices || typeof settings.voices !== "object") settings.voices = {};
const saveSettings = () => jset("peppe-settings", settings);

let historyItems = jget("peppe-history", []);
let libraryItems = jget("peppe-library", []);
if (!Array.isArray(historyItems)) historyItems = [];
if (!Array.isArray(libraryItems)) libraryItems = [];
function loadBatch() {
  const b = jget("peppe-batch", null), out = C.newBatch();
  if (!b || typeof b !== "object" || !b.items || typeof b.items !== "object") return out;
  out.name = String(b.name || "").slice(0, 60); out.seq = Number(b.seq) || 0;
  Object.keys(b.items).slice(0, C.BATCH_CAP).forEach(k => {
    const x = b.items[k];
    if (x && typeof x.value === "string" && x.value) out.items[String(k)] = { value: x.value, format: String(x.format || ""), count: Math.max(1, Math.floor(Number(x.count)) || 1), seq: Number(x.seq) || 0, first: String(x.first || ""), last: String(x.last || "") };
  });
  return out;
}
let batch = loadBatch();
const isCont = () => settings.continuous || settings.batchMode;
const APP_VERSION = "5.4";
function loadExpected() {
  const e = jget("peppe-expected", null), out = { items: [] };
  if (e && Array.isArray(e.items)) e.items.slice(0, C.INV_CAP).forEach(x => {
    if (x && typeof x.code === "string" && x.code && Number.isFinite(x.qty) && x.qty >= 0) out.items.push({ code: x.code.slice(0, 64), qty: Math.floor(x.qty), desc: String(x.desc || "").slice(0, 80) });
  });
  return out;
}
let expected = loadExpected(), expectedMap = new Map(), invNote = "";
const buildExpectedMap = () => { expectedMap = new Map(expected.items.map(i => [C.invKey(i.code), i])); };
buildExpectedMap();

/* ================= Idioma ================= */
let lang = rawGet("peppe-lang");
if (!I[lang]) { const b = (navigator.language || "pt").slice(0, 2); lang = I[b] ? b : "pt"; }
function t(k, p) {
  let s = (I[lang] && I[lang][k]) ?? I.pt[k] ?? k;
  if (p) for (const x in p) s = s.split("{" + x + "}").join(p[x]);
  return s;
}
const fmtMoney = n => { try { return new Intl.NumberFormat(LANGTAG[lang], { style: "currency", currency: "BRL" }).format(n); } catch { return "R$ " + n.toFixed(2); } };
const fmtDate = (iso, long) => { try { return new Date(iso + "T12:00:00").toLocaleDateString(LANGTAG[lang], long ? { day: "numeric", month: "long", year: "numeric" } : undefined); } catch { return iso; } };

/* ================= Utilidades de UI ================= */
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (attrs[k] == null) continue;
    if (k === "class") e.className = attrs[k];
    else if (k === "text") e.textContent = attrs[k];
    else if (k.startsWith("on")) e[k] = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  kids.flat().forEach(c => { if (c != null) e.append(c); });
  return e;
}
let toastTimer = null;
function toast(m) {
  const n = $("toast");
  n.textContent = m; n.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove("show"), 2400);
}
const hostOf = u => { try { return new URL(/^https?:/i.test(u) ? u : "https://" + u).hostname; } catch { return u; } };
const canOpen = s => (/^https?:\/\//i.test(s) && !!C.analyzeUrl(s)) || /^(mailto|tel|sms|smsto|geo):/i.test(s);

/* ================= Voz ================= */
const synth = ("speechSynthesis" in window) ? window.speechSynthesis : null;
let voices = [];
const norm = l => String(l || "").toLowerCase().replace("_", "-");
const langVoices = () => voices.filter(v => norm(v.lang).startsWith(LANGTAG[lang].slice(0, 2).toLowerCase()));
function voiceScore(v) {
  const n = v.name || "";
  let s = 0;
  if (lang === "pt") {
    if (/thalita/i.test(n)) s += 100;
    if (/francisca/i.test(n)) s += 60;
    if (/ant[oô]nio/i.test(n)) s += 30;
  }
  if (/natural|neural/i.test(n)) s += 40;
  if (/online/i.test(n)) s += 10;
  if (norm(v.lang) === norm(LANGTAG[lang])) s += 20;
  if (/google/i.test(n)) s += 5;
  if (v.localService) s += 2;
  return s;
}
function pickVoice() {
  const list = langVoices();
  if (!list.length) return null;
  const saved = settings.voices[lang];
  if (saved) { const v = list.find(x => x.voiceURI === saved); if (v) return v; }
  return list.slice().sort((a, b) => voiceScore(b) - voiceScore(a))[0];
}
function say(text, opts = {}) {
  if (!synth || !settings.voice || !text) return;
  try {
    if (!opts.queue) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANGTAG[lang];
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Number(settings.rate) || 1;
    setTimeout(() => { try { synth.speak(u); } catch {} }, opts.queue ? 0 : 60);
  } catch {}
}
function primeVoice() {   // iOS/Safari exigem um gesto do usuário para liberar a voz
  if (!synth || !settings.voice) return;
  try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); } catch {}
}
function loadVoices() { if (!synth) return; voices = synth.getVoices() || []; populateVoiceSelect(); }
function populateVoiceSelect() {
  const sel = $("setVoicePick");
  sel.replaceChildren(el("option", { value: "", text: t("set_voice_auto") }));
  const list = langVoices();
  list.forEach(v => sel.append(el("option", { value: v.voiceURI, text: v.name + " (" + v.lang + ")" })));
  const saved = settings.voices[lang];
  sel.value = saved && list.some(v => v.voiceURI === saved) ? saved : "";
  updateVoiceUsing();
}
function updateVoiceUsing() {
  if (!synth) { $("voiceUsing").textContent = t("set_novoice"); return; }
  const v = pickVoice();
  $("voiceUsing").textContent = v ? t("set_voice_using", { name: v.name }) : "";
}
function updateVoiceBtn() {
  $("voiceBtn").textContent = t(settings.voice ? "voice_btn_on" : "voice_btn_off");
  $("voiceBtn").setAttribute("aria-pressed", String(settings.voice));
}

/* ================= Resultado ================= */
let current = "", currentFmt = "", currentInfo = null, autoTimer = null;
const isSaved = s => libraryItems.some(x => x.value === s);
const kindLabel = k => t("kind_" + k);
function badgeText(info, fmt) {
  const label = kindLabel(info.kind);
  return fmt ? C.formatLabel(fmt) + " · " + label : label;
}
function row(dl, label, val) {
  if (val == null || val === "") return;
  dl.append(el("dt", { text: label }), el("dd", null, val));
}
const pill = (cls, text) => el("span", { class: "pill " + cls, text });

function buildInfo(info) {
  const d = info.data, dl = el("dl"), extra = [];
  switch (info.kind) {
    case "pix":
      if (d.dynamic) { row(dl, t("lbl_charge"), t("pix_dynamic")); row(dl, t("lbl_host"), hostOf(d.url)); }
      else row(dl, t("lbl_key"), d.key);
      row(dl, t("lbl_receiver"), d.name);
      row(dl, t("lbl_city"), d.city);
      row(dl, t("lbl_amount"), d.amount ? fmtMoney(Number(d.amount)) : t("lbl_none"));
      if (!d.dynamic) row(dl, t("lbl_txid"), d.txid);
      row(dl, t("lbl_check"), pill(d.crcOk ? "ok" : "bad", t(d.crcOk ? "pix_crc_ok" : "pix_crc_bad")));
      break;
    case "url":
      row(dl, t("lbl_host"), el("b", { text: d.host }));
      break;
    case "wifi":
      row(dl, t("lbl_network"), d.ssid);
      row(dl, t("lbl_security"), d.auth && d.auth !== "nopass" ? d.auth : t("lbl_open_net"));
      row(dl, t("lbl_password"), d.password);
      if (d.hidden) row(dl, t("lbl_hidden"), t("lbl_yes"));
      break;
    case "vcard":
      row(dl, t("lbl_name"), d.name); row(dl, t("lbl_org"), d.org);
      row(dl, t("lbl_phone"), d.phones.join(", ")); row(dl, t("lbl_email"), d.emails.join(", ")); row(dl, t("lbl_site"), d.url);
      break;
    case "boleto":
      row(dl, t("lbl_bank"), (d.bank + " " + (d.bankName || "")).trim());
      row(dl, t("lbl_amount"), fmtMoney(d.amount));
      row(dl, t("lbl_due"), d.due ? fmtDate(d.due) : t("lbl_nodue"));
      row(dl, t("lbl_check"), pill(d.dvOk ? "ok" : "bad", t(d.dvOk ? "dv_ok" : "dv_bad")));
      break;
    case "gtin": case "isbn":
      row(dl, t("lbl_type"), d.type);
      row(dl, t("lbl_check"), pill(d.valid ? "ok" : "bad", t(d.valid ? "dv_ok" : "dv_bad")));
      if (d.brazil) row(dl, t("lbl_country"), t("lbl_br"));
      break;
    case "nfe":
      row(dl, t("lbl_check"), pill("ok", t("dv_ok")));
      break;
    default: return null;
  }
  const box = el("div", { class: "info-box" });
  if (dl.children.length) box.append(dl);
  extra.forEach(x => box.append(x));
  return box.children.length ? box : null;
}

function renderVerdict(info) {
  const box = $("verdict"), a = C.assess(info);
  box.replaceChildren();
  if (a.level === "info") { box.className = "verdict hidden"; return a; }
  box.className = "verdict " + a.level;
  box.append(el("b", { text: t("v_" + a.level) }), el("ul", null, a.reasons.map(r => el("li", { text: t(r.key, r.params) }))));
  return a;
}
function handoff(info, bank) {
  const text = info.kind === "boleto" ? C.barcodeToLinha(info.data.barcode) : current;
  let p;
  try { p = navigator.clipboard.writeText(text); } catch { p = Promise.reject(); }
  if (bank) window.open(bank.url, "_blank", "noopener,noreferrer");   // só o site oficial, sem enviar dados
  p.then(() => { toast(t("bank_copied")); say(bank ? t("say_bank_open", { bank: bank.name }) : t("say_bank_copied")); }).catch(() => toast(t("copyFail")));
}
function renderExtra(info) {
  const wrap = $("extraActions");
  wrap.replaceChildren();
  if (info.kind === "wifi" && info.data.password) {
    wrap.append(el("button", {
      text: t("copy_pass"),
      onclick: async () => { try { await navigator.clipboard.writeText(info.data.password); toast(t("pass_copied")); } catch { toast(t("copyFail")); } }
    }));
  }
  if ((info.kind === "pix" || info.kind === "boleto") && C.assess(info).level !== "bad") {
    const bank = C.BANK_SITES.find(b => b.id === settings.bank);
    wrap.append(el("button", { class: "primary", text: bank ? t("bank_open", { bank: bank.name }) : t("bank_copy"), onclick: () => handoff(info, bank) }));
  }
  if (info.kind === "vcard") {
    wrap.append(el("button", {
      text: t("download_vcard"),
      onclick: () => downloadBlob(new Blob([current], { type: "text/vcard" }), "contato.vcf")
    }));
  }
}

function showResult(s, add = true, fmt = "") {
  if (!s) return null;
  cancelAuto();
  current = s; currentFmt = fmt || "";
  const info = currentInfo = C.classify(s, fmt);
  $("empty").classList.add("hidden");
  $("result").classList.add("show");
  $("resultText").textContent = s;
  $("resultType").textContent = badgeText(info, fmt);
  $("saveCodeBtn").textContent = t(isSaved(s) ? "saved" : "save");
  const can = canOpen(s);
  $("openBtn").disabled = !can;
  $("openHint").textContent = t(can ? "open_hint_ok" : "open_hint_no");
  const lookable = info.kind === "gtin" || info.kind === "isbn";
  $("lookupBtn").classList.toggle("hidden", !lookable);
  $("lookupBtn").textContent = t(info.kind === "isbn" ? "lookup_book" : "lookup");
  $("productInfo").replaceChildren();
  $("infoBox").replaceChildren();
  renderVerdict(info);
  $("editBox").classList.add("hidden");
  const box = buildInfo(info);
  if (box) $("infoBox").append(box);
  renderExtra(info);
  if (add && !historyItems.some(x => x.value === s)) {
    historyItems.unshift({ value: s, format: fmt || "", time: new Date().toISOString() });
    historyItems = historyItems.slice(0, 100);
    saveHistory(); renderHistory(); updateStats();
  }
  return info;
}

/* ---- abrir link (manual e automático) ---- */
function doOpen(s) {
  if (/^https?:\/\//i.test(s)) window.open(s, "_blank", "noopener,noreferrer");
  else if (canOpen(s)) location.href = s;
}
function cancelAuto() {
  clearInterval(autoTimer); autoTimer = null;
  $("autoBar").classList.add("hidden");
}
function maybeAutoOpen(s, info) {
  cancelAuto();
  if (!settings.autoOpen || isCont()) return false;
  if (info.kind !== "url" || info.data.flags.length || info.data.protocol !== "https:") return false;
  let n = 3;
  $("autoBar").classList.remove("hidden");
  $("autoTxt").textContent = t("autoopen_in", { n });
  autoTimer = setInterval(() => {
    n--;
    if (n <= 0) { cancelAuto(); say(t("say_opening")); location.assign(s); }
    else $("autoTxt").textContent = t("autoopen_in", { n });
  }, 1000);
  return true;
}
$("autoCancel").onclick = cancelAuto;

/* ---- avisos por voz após a leitura ---- */
function announce(info, auto) {
  const d = info.data;
  let m;
  switch (info.kind) {
    case "url":
      if (d.brand) { m = t("say_read_url_brand", { brand: d.brand }); break; }
      m = t(d.flags.length ? "say_read_url_warn" : "say_read_url", { host: d.host }); if (auto) m += " " + t("say_will_open"); break;
    case "file": case "script": case "applink": case "otp": case "crypto": m = t("say_read_odd", { kind: kindLabel(info.kind) }); break;
    case "pix": m = d.crcOk ? t("say_read_pix", { amount: d.amount ? t("say_amount", { v: fmtMoney(Number(d.amount)) }) : "" }) : t("say_read_pix_bad"); break;
    case "boleto": m = d.dvOk ? t("say_read_boleto", { amount: t("say_amount", { v: fmtMoney(d.amount) }), due: d.due ? t("say_due", { d: fmtDate(d.due, true) }) : "" }) : t("say_read_boleto_bad"); break;
    case "gtin": m = t("say_read_gtin"); break;
    case "isbn": m = t("say_read_isbn"); break;
    case "wifi": m = t("say_read_wifi", { ssid: d.ssid }); break;
    case "vcard": m = t("say_read_vcard"); break;
    case "nfe": m = t("say_read_nfe"); break;
    case "utility": m = t("say_read_utility"); break;
    default: m = t("say_read_text");
  }
  say(m);
}

/* ---- sinais sonoros e vibração ---- */
let audioCtx = null;
function beep(freq) {
  if (!settings.beep) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq || 880; g.gain.value = .05;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + .09);
  } catch {}
}
function feedback() {
  if (settings.vibrate) { try { navigator.vibrate?.([90, 45, 90]); } catch {} }
  beep();
}

function handleScan(text, fmt) {
  if (settings.batchMode) { batchRead(text, fmt); return null; }
  const info = showResult(text, true, fmt);
  feedback();
  if (!isCont() && window.innerWidth <= 760) { try { $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" }); } catch {} }
  const auto = maybeAutoOpen(text, info);
  announce(info, auto);
  if (settings.autoLookup && (info.kind === "gtin" || info.kind === "isbn")) lookup(text, info.kind, true);
}

/* ================= Consulta de produto / livro ================= */
async function fetchJson(url) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw Error("http"); return await r.json(); }
  finally { clearTimeout(to); }
}
async function lookupOff(code) {
  const codes = [code]; if (code.length === 12) codes.push("0" + code);
  for (const c of codes) {
    try {
      const j = await fetchJson("https://world.openfoodfacts.org/api/v2/product/" + encodeURIComponent(c) + ".json?fields=product_name,brands,quantity,categories,image_front_small_url");
      if (j.status === 1 && j.product) {
        const p = j.product;
        return { title: p.product_name || "", sub: [p.brands, p.quantity, p.categories], img: p.image_front_small_url };
      }
    } catch {}
  }
  throw Error("none");
}
async function lookupIsbn(code) {
  const j = await fetchJson("https://openlibrary.org/api/books?bibkeys=ISBN:" + code + "&format=json&jscmd=data");
  const b = j["ISBN:" + code];
  if (!b) throw Error("none");
  return { title: b.title, sub: [(b.authors || []).map(a => a.name).join(", "), (b.publishers || []).map(p => p.name).join(", "), b.publish_date], img: b.cover && b.cover.small };
}
async function lookup(code, kind, speak) {
  const box = $("productInfo");
  box.textContent = t("looking");
  try {
    const r = kind === "isbn" ? await lookupIsbn(code) : await lookupOff(code);
    if (current !== code) return;
    const wrap = el("div", { class: "info-box product" });
    if (r.img) wrap.append(el("img", { src: r.img, alt: "" }));
    wrap.append(el("div", null, el("h3", { text: r.title || t("product_nameless") }), el("p", { text: r.sub.filter(Boolean).join(" · ") || t("no_details") })));
    box.replaceChildren(wrap);
    if (speak && r.title) say(t("say_product", { name: r.title }), { queue: true });
  } catch {
    if (current !== code) return;
    box.textContent = t("product_none");
    if (speak) say(t("say_not_found"), { queue: true });
  }
}

/* ================= Câmera ================= */
let scanner = null, running = false, scanBusy = false, sessionCount = 0, lastCode = "", lastCodeTime = 0;
let torchOn = false, cameraList = [], camIdx = 0, hintTimer = null, hintCount = 0, statusState = null;

function setStatus(key, params) { statusState = key ? { key, params } : null; $("cameraStatus").textContent = key ? t(key, params) : ""; }
function setCamUi(on) {
  $("startBtn").disabled = on; $("stopBtn").disabled = !on;
  $("torchBtn").disabled = !on;
  if (!on) { ["switchBtn", "zoomWrap"].forEach(i => $(i).classList.add("hidden")); $("torchBtn").textContent = t("torch"); }
}
function formatsFor(mode) {
  const E = window.Html5QrcodeSupportedFormats;
  if (!E) return [];
  const names = mode === "qr" ? ["QR_CODE"] : mode === "barcode" ? C.F1D : [...C.F2D, ...C.F1D];
  return names.map(k => E[k]).filter(x => x !== undefined);
}
function qrboxFor(w, h) {
  const m = settings.mode;
  if (m === "qr") { const s = Math.max(50, Math.floor(Math.min(w, h) * .7)); return { width: s, height: s }; }
  if (m === "barcode") { const bw = Math.floor(w * .9); return { width: bw, height: Math.max(50, Math.min(Math.floor(h * .55), Math.floor(bw * .45))) }; }
  const bw = Math.floor(w * .88);
  return { width: bw, height: Math.max(50, Math.floor(Math.min(h * .8, bw * .8))) };
}

function stopHints() { clearInterval(hintTimer); hintTimer = null; }
function startHints() {
  stopHints(); hintCount = 0;
  if (isCont()) return;
  hintTimer = setInterval(() => {
    if (!running) return;
    hintCount++;
    const key = "say_hint" + ((hintCount - 1) % 4 + 1);
    setStatus(key); say(t(key));
    if (hintCount >= 8) stopHints();
  }, 7000);
}

async function stop() {
  stopHints(); stopGuide();
  if (scanner) {
    try { if (running) await scanner.stop(); } catch {}
    try { scanner.clear(); } catch {}
  }
  running = false; torchOn = false;
  setCamUi(false);
}

function setupCamExtras() {
  try {
    const caps = scanner.getRunningTrackCameraCapabilities();
    const zf = caps.zoomFeature();
    if (zf.isSupported()) {
      const r = $("zoomRange");
      r.min = zf.min(); r.max = Math.min(zf.max(), 8); r.step = zf.step() || 0.1; r.value = zf.value() || zf.min();
      $("zoomWrap").classList.remove("hidden");
      r.oninput = () => { try { Promise.resolve(zf.apply(Number(r.value))).catch(() => {}); } catch {} };
    }
  } catch {}
  Html5Qrcode.getCameras().then(list => {
    cameraList = list || [];
    if (cameraList.length > 1) {
      $("switchBtn").classList.remove("hidden");
      try { const cur = scanner.getRunningTrackSettings().deviceId; const i = cameraList.findIndex(c => c.id === cur); camIdx = i >= 0 ? i : 0; } catch { camIdx = 0; }
    }
  }).catch(() => {});
}

function videoTrack() {
  try { const v = $("reader").querySelector("video"); return (v && v.srcObject && v.srcObject.getVideoTracks()[0]) || null; } catch { return null; }
}
async function setTorch(on) {
  try { const tf = scanner.getRunningTrackCameraCapabilities().torchFeature(); if (tf.isSupported()) { await tf.apply(on); return true; } } catch {}
  try { const tr = videoTrack(), caps = tr && tr.getCapabilities && tr.getCapabilities(); if (caps && caps.torch) { await tr.applyConstraints({ advanced: [{ torch: on }] }); return true; } } catch {}
  return false;
}
$("torchBtn").onclick = async () => {
  if (!running) return;
  const want = !torchOn;
  if (await setTorch(want)) { torchOn = want; $("torchBtn").textContent = t(torchOn ? "torch_off" : "torch"); }
  else toast(t("torch_unsupported"));
};

function onDecoded(text, res) {
  guideFallback.read();
  const fmt = (res && res.result && res.result.format && res.result.format.formatName) || "";
  const now = Date.now();
  if (isCont()) {
    const gap = settings.batchMode ? 1500 : 3000;   // no lote, tirar o código da vista e voltar conta nova leitura
    if (text === lastCode && now - lastCodeTime < gap) { lastCodeTime = now; return; }
    lastCode = text; lastCodeTime = now; sessionCount++;
    handleScan(text, fmt);
    if (settings.batchMode) setStatus("cam_batch", { n: batchCount(), r: batchReads() });
    else setStatus("cam_session", { n: sessionCount });
    return;
  }
  if (scanBusy) return;
  scanBusy = true;
  stopHints();
  handleScan(text, fmt);
  setStatus("cam_done");
  setTimeout(stop, 0);
}

/* ================= Guia visual + motor alternativo (BarcodeDetector) ================= */
let guideTimer = null, guideDet = null, guideBusy = false, guideEngine = "main", guidePrev = null, guideSeen = new Map(), guideSaid = {};
const guideFallback = C.makeFallback(4000, 3);
let guideHintKey = null;
const GUIDE_COLORS = { ok: "#22c55e", bad: "#ef4444", pending: "#ffffff", warn: "#fbbf24" };

function guideCtx(cv) { try { const g = cv.getContext && cv.getContext("2d"); return g && typeof g.clearRect === "function" ? g : null; } catch { return null; } }
function guideVideo() { return $("reader").querySelector("video"); }
function guideSize(cv) {
  const r = $("camWrap").getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return d;
}
function guideClear() { const cv = $("guide"), g = guideCtx(cv); if (g) g.clearRect(0, 0, cv.width, cv.height); }
function guideSay(key, ms) {
  const now = Date.now();
  if (isCont() || now - (guideSaid[key] || 0) < (ms || 7000)) return;
  guideSaid[key] = now; say(t("say_guide_" + key), { queue: true });
}
// Desenha o contorno, os 4 cantos como bolinhas e um rótulo em texto (a cor nunca é o único sinal)
function guideDraw(items, v) {
  const cv = $("guide"), g = guideCtx(cv);
  if (!g) return;
  const d = guideSize(cv);
  g.clearRect(0, 0, cv.width, cv.height);
  const wrap = $("camWrap").getBoundingClientRect(), vr = v.getBoundingClientRect();
  const sx = vr.width / (v.videoWidth || 1), sy = vr.height / (v.videoHeight || 1), ox = vr.left - wrap.left, oy = vr.top - wrap.top;
  g.lineJoin = "round"; g.textBaseline = "top"; g.font = "600 " + 13 * d + "px system-ui, sans-serif";
  items.forEach(it => {
    const pts = it.points.map(p => ({ x: (ox + p.x * sx) * d, y: (oy + p.y * sy) * d }));
    const col = GUIDE_COLORS[it.level] || GUIDE_COLORS.pending;
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath();
    g.lineWidth = 5 * d; g.strokeStyle = "rgba(0,0,0,.55)"; g.stroke();
    g.lineWidth = 2.5 * d; g.strokeStyle = col; g.stroke();
    pts.forEach(p => { g.beginPath(); g.arc(p.x, p.y, 6.5 * d, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 2 * d; g.strokeStyle = "rgba(0,0,0,.7)"; g.stroke(); });
    if (it.label) {
      const tw = g.measureText(it.label).width, x = Math.max(4 * d, Math.min(pts[0].x, cv.width - tw - 14 * d)), y = Math.max(4 * d, Math.min(...pts.map(p => p.y)) - 24 * d);
      g.fillStyle = "rgba(0,0,0,.72)"; g.fillRect(x, y, tw + 10 * d, 20 * d);
      g.fillStyle = col; g.fillText(it.label, x + 5 * d, y + 3 * d);
    }
  });
}
// Mira fixa quando o aparelho não tem detector nativo (sem posição real do código)
function guideReticle() {
  const cv = $("guide"), g = guideCtx(cv);
  if (!g) return;
  const d = guideSize(cv), w = cv.width, h = cv.height, bar = settings.mode === "barcode", s = Math.min(w, h) * .55;
  const bw = bar ? Math.min(w * .8, s * 1.9) : s, bh = bar ? s * .6 : s;
  const x = (w - bw) / 2, y = (h - bh) / 2, L = Math.min(bw, bh) * .22;
  g.clearRect(0, 0, w, h); g.lineWidth = 3.5 * d; g.lineCap = "round"; g.strokeStyle = "rgba(255,255,255,.85)";
  [[x, y, 1, 1], [x + bw, y, -1, 1], [x, y + bh, 1, -1], [x + bw, y + bh, -1, -1]].forEach(([cx, cy, dx, dy]) => {
    g.beginPath(); g.moveTo(cx + dx * L, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * L); g.stroke();
  });
}
const guideLabelFor = level => level === "ok" ? t("guide_read") : level === "bad" ? t("guide_unknown") : "";
function statusLocked() { return statusState && /^(cam_done|cam_batch|cam_session|cam_denied|cam_fail)/.test(statusState.key); }

async function guideTick() {
  if (guideBusy || !running || !guideDet) return;
  const v = guideVideo();
  if (!v || v.readyState < 2 || !v.videoWidth) return;
  guideBusy = true;
  try {
    const codes = await guideDet.detect(v);
    if (!running) return;
    const now = Date.now(), items = [];
    codes.forEach(cd => {
      const text = String(cd.rawValue || ""), pts = cd.cornerPoints && cd.cornerPoints.length ? cd.cornerPoints : null;
      if (!pts) return;
      const fmt = String(cd.format || "").toUpperCase();
      let inB = false, unexp = false;
      if (settings.batchMode && text) {
        inB = !!batch.items[C.batchKey(text, fmt)];
        if (expectedMap.size && C.INV_KINDS.includes(C.classify(text, fmt).kind)) unexp = !expectedMap.has(C.invKey(text));
      }
      items.push({ text, points: pts, format: fmt, level: C.guideLevel(inB, unexp), box: C.guideBox(pts, v.videoWidth, v.videoHeight) });
    });
    // orientação em texto (aproximar / segurar firme) a partir do maior código à vista
    const main = items.slice().sort((a, b) => (b.box ? b.box.area : 0) - (a.box ? a.box.area : 0))[0];
    const hint = main ? C.guideHint(main.box, guidePrev) : "none";
    guidePrev = main ? main.box : null;
    items.forEach(it => { it.label = guideLabelFor(it.level) || (it === main && (hint === "closer" || hint === "hold") ? t("guide_" + hint) : ""); });
    if (settings.guide) guideDraw(items, v); else guideClear();
    if (hint !== guideHintKey && !statusLocked()) { guideHintKey = hint; setStatus(hint === "none" ? "cam_active" : hint === "ok" ? "guide_ok" : "guide_" + hint); }
    if (hint === "closer" || hint === "hold") guideSay(hint);

    if (!items.length) { guideFallback.lost(); return; }
    if (guideEngine === "main") {
      // código à vista mas o leitor principal não decodifica: após 3 janelas, o nativo assume
      if (guideFallback.seen(now)) {
        guideEngine = "native"; setStatus("guide_switch"); say(t("say_guide_switch"), { queue: true }); toast(t("guide_switch"));
      }
      return;
    }
    // motor alternativo: o próprio detector nativo decodifica (uma leitura por aparição)
    const live = new Set();
    items.forEach(it => {
      if (!it.text) return;
      live.add(it.text);
      const prevAt = guideSeen.get(it.text);
      guideSeen.set(it.text, now);
      if (prevAt && now - prevAt < 900) return;
      onDecoded(it.text, { result: { format: { formatName: it.format } } });
    });
    for (const [k, at] of guideSeen) if (!live.has(k) && now - at > 2500) guideSeen.delete(k);
  } catch { /* quadro sem imagem: tenta de novo */ }
  finally { guideBusy = false; }
}

async function startGuide() {
  stopGuide();
  guideFallback.reset(); guideEngine = "main"; guidePrev = null; guideSeen = new Map(); guideSaid = {}; guideHintKey = null;
  if ("BarcodeDetector" in window) {
    try {
      const sup = await window.BarcodeDetector.getSupportedFormats();
      const want = settings.mode === "qr" ? ["qr_code"] : settings.mode === "barcode" ? C.F1D.map(f => f.toLowerCase()) : null;
      const fmts = want ? want.filter(f => sup.includes(f)) : null;
      guideDet = fmts && fmts.length ? new window.BarcodeDetector({ formats: fmts }) : new window.BarcodeDetector();
      guideTimer = setInterval(guideTick, 120);
      return;
    } catch { guideDet = null; }
  }
  if (settings.guide) guideReticle();
}
function stopGuide() { clearInterval(guideTimer); guideTimer = null; guideDet = null; guideBusy = false; try { guideClear(); } catch {} }

async function startCamera(forceId) {
  if (running) return;
  if (!window.Html5Qrcode) { setStatus("cam_noLib"); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus("cam_noApi"); return; }
  scanBusy = false; sessionCount = 0; lastCode = "";
  setCamUi(true); setStatus("cam_asking");

  const fm = formatsFor(settings.mode);
  const base = native => ({ verbose: false, useBarCodeDetectorIfSupported: native, experimentalFeatures: { useBarCodeDetectorIfSupported: native } });
  const withF = native => Object.assign(base(native), fm.length ? { formatsToSupport: fm } : {});
  const savedId = forceId || rawGet("peppe-cam");
  const attempts = [];
  if (savedId) attempts.push({ name: "id", cam: savedId, opts: withF(true) });
  attempts.push(
    { name: "env-native", cam: { facingMode: "environment" }, opts: withF(true) },
    { name: "env-zxing", cam: { facingMode: "environment" }, opts: withF(false) },
    { name: "env-all", cam: { facingMode: "environment" }, opts: base(false) },
    { name: "user", cam: { facingMode: "user" }, opts: base(false) },
    { name: "list", cam: null, opts: base(false) }
  );
  const scanCfg = { fps: 10, qrbox: qrboxFor };
  let lastErr = null;

  for (const at of attempts) {
    try {
      await stop(); setCamUi(true);
      scanner = new Html5Qrcode("reader", at.opts);
      let cam = at.cam;
      if (!cam) {
        const list = await Html5Qrcode.getCameras();
        if (!list.length) throw Error("NotFound");
        const back = list.find(c => /back|rear|traseira|environment/i.test(c.label)) || list[list.length - 1];
        cam = back.id;
      }
      await scanner.start(cam, scanCfg, onDecoded, () => {});
      running = true;
      setCamUi(true); $("stopBtn").disabled = false;
      setStatus("cam_active");
      say(t("say_start"));
      startHints(); startGuide().catch(() => {});
      try { await scanner.applyVideoConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch {}
      setupCamExtras();
      return;
    } catch (e) {
      lastErr = e;
      console.warn("Falha ao iniciar câmera (" + at.name + ")", e);
      if (/NotAllowed|Permission/i.test(String(e && e.name) + String(e))) break;
    }
  }
  await stop();
  const m = String((lastErr && lastErr.name) || "") + " " + String(lastErr || "");
  setStatus(/NotAllowed|Permission/i.test(m) ? "cam_denied" : /NotFound|Nenhuma/i.test(m) ? "cam_notFound" : /NotReadable|TrackStart/i.test(m) ? "cam_busy" : "cam_fail");
  toast(t("cam_failToast"));
}

$("startBtn").onclick = () => { primeVoice(); startCamera(); };
$("stopBtn").onclick = stop;
$("switchBtn").onclick = async () => {
  if (cameraList.length < 2) return;
  camIdx = (camIdx + 1) % cameraList.length;
  const id = cameraList[camIdx].id;
  rawSet("peppe-cam", id);
  await stop(); startCamera(id);
};
$("scanMode").onchange = async e => {
  settings.mode = e.target.value; saveSettings();
  if (running) { await stop(); startCamera(); }
};
$("continuousToggle").onchange = e => { settings.continuous = e.target.checked; saveSettings(); if (running) startHints(); };
$("voiceBtn").onclick = () => {
  settings.voice = !settings.voice; saveSettings(); $("setVoice").checked = settings.voice; updateVoiceBtn();
  if (settings.voice) { primeVoice(); say(t("say_voice_on")); } else if (synth) synth.cancel();
};
document.addEventListener("visibilitychange", () => { if (document.hidden && running) stop(); });

$("cameraTab").onclick = () => {
  $("cameraTab").setAttribute("aria-selected", "true"); $("imageTab").setAttribute("aria-selected", "false");
  $("cameraMode").classList.remove("hidden"); $("imageMode").classList.add("hidden");
};
$("imageTab").onclick = async () => {
  await stop();
  $("imageTab").setAttribute("aria-selected", "true"); $("cameraTab").setAttribute("aria-selected", "false");
  $("cameraMode").classList.add("hidden"); $("imageMode").classList.remove("hidden");
};

/* ================= Leitura por imagem ================= */
function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, max = 0, th = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; th = i; }
  }
  return th;
}
const VARIANTS = [
  { max: 2000 }, { max: 2000, enh: 1 }, { max: 2000, enh: 1, bin: 1 },
  { max: 2000, half: 1 }, { max: 2000, half: 1, enh: 1 },
  { max: 1000 }, { max: 1600, up: 1, enh: 1 }, { max: 1400, up: 1, enh: 1, bin: 1 }
];
async function nativeDetect(file) {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const bmp = await createImageBitmap(file), det = new window.BarcodeDetector(), r = await det.detect(bmp);
    if (bmp.close) bmp.close();
    const list = (r || []).filter(x => x && x.rawValue).map(x => ({ text: x.rawValue, fmt: String(x.format || "").toUpperCase() }));
    if (list.length) return list;
  } catch {}
  return null;
}
async function scanVariant(file, v) {
  const img = await createImageBitmap(file);
  const big = Math.max(img.width, img.height);
  const scale = (v.up ? Math.min(2, v.max / big) : Math.min(1, v.max / big)) * (v.half ? 0.5 : 1);
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (img.close) img.close();
  if (v.enh || v.bin) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height), d = data.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) { const g = Math.round(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]); d[i] = d[i + 1] = d[i + 2] = g; hist[g]++; }
    const th = v.bin ? otsu(hist, d.length / 4) : 0;
    for (let i = 0; i < d.length; i += 4) {
      let g = d[i];
      g = v.bin ? (g > th ? 255 : 0) : Math.max(0, Math.min(255, (g - 128) * 1.45 + 128));
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(data, 0, 0);
  }
  const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(Error("blob")), "image/png"));
  const source = new File([blob], "imagem.png", { type: "image/png" });
  const host = new Html5Qrcode("imgHost", { verbose: false, formatsToSupport: formatsFor("all") });
  try {
    if (host.scanFileV2) { const r = await host.scanFileV2(source, false); return { text: r.decodedText, fmt: (r.result && r.result.format && r.result.format.formatName) || "" }; }
    return { text: await host.scanFile(source, false), fmt: "" };
  } finally { try { host.clear(); } catch {} }
}
let fileIdle = true;
async function tryImage(file) {
  if (!file) return;
  fileIdle = false;
  if (!window.Html5Qrcode) { $("fileStatus").textContent = t("cam_noLib"); return; }
  $("fileStatus").textContent = t("img_analyzing");
  const nat = await nativeDetect(file);
  if (nat) {
    if (settings.batchMode) {
      nat.forEach(x => batchRead(x.text, x.fmt, true));
      feedback(); say(t("say_batch_multi", { n: nat.length }));
      $("fileStatus").textContent = t("img_multi", { n: nat.length });
    } else {
      handleScan(nat[0].text, nat[0].fmt);
      $("fileStatus").textContent = nat.length > 1 ? t("img_multi_hint", { n: nat.length }) : t("img_found");
    }
    return;
  }
  for (const v of VARIANTS) {
    try {
      const r = await scanVariant(file, v);
      if (r && r.text) { handleScan(r.text, r.fmt); $("fileStatus").textContent = t("img_found"); return; }
    } catch {}
  }
  $("fileStatus").textContent = t("img_notfound");
}
async function acceptImage(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) { toast(t("img_pickfile")); return; }
  primeVoice(); await tryImage(file);
}
$("imageInput").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; await acceptImage(f); };
$("pasteBtn").onclick = async () => {
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) throw Error();
    const items = await navigator.clipboard.read();
    for (const item of items) { const ty = item.types.find(x => x.startsWith("image/")); if (ty) { await acceptImage(await item.getType(ty)); return; } }
    throw Error();
  } catch { $("fileStatus").textContent = t("img_paste_unavail"); }
};
$("dropZone").addEventListener("dragover", e => { e.preventDefault(); $("dropZone").style.borderColor = "var(--accent)"; });
$("dropZone").addEventListener("dragleave", () => { $("dropZone").style.borderColor = ""; });
$("dropZone").addEventListener("drop", e => { e.preventDefault(); $("dropZone").style.borderColor = ""; acceptImage(e.dataTransfer.files[0]); });
document.addEventListener("paste", e => {
  const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(x => x.type.startsWith("image/"));
  if (item && !$("imageMode").classList.contains("hidden")) acceptImage(item.getAsFile());
});

/* ================= Ações do resultado ================= */
async function copyText(s, okMsg) { try { await navigator.clipboard.writeText(s); toast(okMsg || t("copied")); } catch { toast(t("copyFail")); } }
$("copyBtn").onclick = () => copyText(current);
$("openBtn").onclick = () => doOpen(current);
$("searchBtn").onclick = () => window.open("https://www.google.com/search?q=" + encodeURIComponent(current), "_blank", "noopener,noreferrer");
$("shareBtn").onclick = async () => { if (navigator.share) { try { await navigator.share({ title: "Leitor QR - Peppe", text: current }); } catch {} } else copyText(current); };
$("editBtn").onclick = () => { if (!current) return; $("editText").value = current; $("editBox").classList.remove("hidden"); $("editText").focus(); };
$("editCancel").onclick = () => $("editBox").classList.add("hidden");
$("editApply").onclick = () => {
  const v = $("editText").value.replace(/\s+$/, "");
  if (!v) return;
  const old = current;
  historyItems.forEach(x => { if (x.value === old) x.value = v; });
  saveHistory();
  showResult(v, false, currentFmt); renderHistory(); updateStats(); toast(t("edited_toast"));
};
$("toGenBtn").onclick = () => { $("qrText").value = current; $("genType").value = "qr"; updateGenUi(); go("generate"); };
$("lookupBtn").onclick = () => lookup(current, currentInfo && currentInfo.kind, false);
$("saveCodeBtn").onclick = () => {
  if (!current) return;
  if (isSaved(current)) { toast(t("toast_already")); return; }
  libraryItems.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), value: current, format: currentFmt, note: "", savedAt: new Date().toISOString() });
  saveLibrary(); renderLibrary();
  $("saveCodeBtn").textContent = t("saved"); toast(t("toast_saved"));
};

/* ================= Histórico, biblioteca e estatísticas ================= */
function saveHistory() { if (!jset("peppe-history", historyItems)) toast(t("toast_storage_full")); }
function saveLibrary() { if (!jset("peppe-library", libraryItems)) toast(t("toast_storage_full")); }
const itemKind = x => C.classify(x.value, x.format).kind;

function renderHistory() {
  const list = $("historyList");
  list.replaceChildren();
  if (!historyItems.length) { list.append(el("p", { class: "hint", text: t("history_empty") })); return; }
  historyItems.slice(0, 12).forEach(x => {
    list.append(el("div", { class: "history-item" },
      el("span", { class: "txt", text: x.value }),
      el("span", { class: "tag", text: kindLabel(itemKind(x)) }),
      el("button", { class: "small", text: t("view"), onclick: () => showResult(x.value, false, x.format) }),
      el("button", { class: "small", text: "×", "aria-label": t("remove"), onclick: () => { historyItems = historyItems.filter(y => y !== x); saveHistory(); renderHistory(); updateStats(); } })
    ));
  });
}
function renderLibrary() {
  const list = $("libraryList"), q = $("librarySearch").value.toLowerCase();
  list.replaceChildren();
  const items = libraryItems.filter(x => (x.value + " " + (x.note || "")).toLowerCase().includes(q));
  if (!items.length) { list.append(el("p", { class: "hint", text: t("lib_empty") })); return; }
  items.forEach(x => {
    list.append(el("div", { class: "history-item" },
      el("span", { class: "txt", text: (x.note ? x.note + " · " : "") + x.value }),
      el("button", { class: "small", text: t("lib_edit"), onclick: () => {
        const n = prompt(t("lib_note_prompt"), x.note || "");
        if (n !== null) { x.note = n.trim().slice(0, 120); saveLibrary(); renderLibrary(); }
      } }),
      el("button", { class: "small", text: t("view"), onclick: () => { showResult(x.value, false, x.format); go("read"); } }),
      el("button", { class: "small", text: t("remove"), onclick: () => { libraryItems = libraryItems.filter(y => y.id !== x.id); saveLibrary(); renderLibrary(); } })
    ));
  });
}
function updateStats() {
  const F1D = C.F1D;
  let qr = 0, bar = 0, links = 0;
  const groups = {};
  historyItems.forEach(x => {
    const k = itemKind(x), f = String(x.format || "").toUpperCase();
    if (f === "QR_CODE" || k === "pix") qr++;
    if (F1D.includes(f) || (!f && ["gtin", "isbn", "boleto", "utility", "nfe"].includes(k))) bar++;
    if (k === "url") links++;
    const g = f ? C.formatLabel(f) : kindLabel(k);
    groups[g] = (groups[g] || 0) + 1;
  });
  $("totalStat").textContent = historyItems.length; $("qrStat").textContent = qr; $("barStat").textContent = bar; $("linkStat").textContent = links;
  const bars = $("formatBars"); bars.replaceChildren();
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8), max = entries.length ? entries[0][1] : 1;
  entries.forEach(([name, n]) => bars.append(el("div", { class: "bar-row" }, el("span", { text: name }), el("div", { class: "bar-track" }, el("div", { class: "bar-fill", style: "width:" + Math.round(n / max * 100) + "%" })), el("span", { text: String(n) }))));
  const recent = $("statsRecent"); recent.replaceChildren();
  historyItems.slice(0, 8).forEach(x => recent.append(el("p", { class: "hint", text: (x.format ? C.formatLabel(x.format) : kindLabel(itemKind(x))) + " — " + x.value.slice(0, 90) })));
}
$("librarySearch").oninput = renderLibrary;
$("clearHistory").onclick = () => { historyItems = []; saveHistory(); renderHistory(); updateStats(); toast(t("toast_history_cleared")); };
$("clearLibrary").onclick = () => { if (confirm(t("lib_confirm_clear"))) { libraryItems = []; saveLibrary(); renderLibrary(); } };

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("exportCsv").onclick = () => {
  const rows = [["date", "format", "type", "content"], ...historyItems.map(x => [x.time || "", x.format || "", itemKind(x), x.value])];
  downloadBlob(new Blob(["\ufeff" + C.toCsv(rows)], { type: "text/csv;charset=utf-8" }), "historico-leitor-qr-peppe.csv");
};
$("libExport").onclick = () => {
  const payload = { app: "leitor-qr-peppe", version: 5, exportedAt: new Date().toISOString(), library: libraryItems, history: historyItems };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "biblioteca-leitor-qr-peppe.json");
};
$("libImport").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const src = Array.isArray(j) ? j : j.library;
    if (!Array.isArray(src)) throw Error();
    let n = 0;
    src.forEach(x => {
      if (x && typeof x.value === "string" && x.value && !isSaved(x.value)) {
        libraryItems.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), value: x.value.slice(0, 4000), format: String(x.format || ""), note: String(x.note || "").slice(0, 120), savedAt: x.savedAt || new Date().toISOString() });
        n++;
      }
    });
    saveLibrary(); renderLibrary(); toast(t("lib_import_ok", { n }));
  } catch { toast(t("lib_import_fail")); }
};

/* ================= Gerador (QR e códigos de barras) ================= */
let logoData = null, pixPayload = "";
function makeQr(text, target, size, level, dark, light) {
  if (!window.QRCode) throw Error("QRCode lib");
  target.replaceChildren();
  const holder = document.createElement("div");
  target.append(holder);
  new QRCode(holder, { text, width: size, height: size, colorDark: dark, colorLight: light, correctLevel: QRCode.CorrectLevel[level] });
  return holder;
}
const canvasOf = target => target.querySelector("canvas");
async function withLogo(canvas) {
  if (!logoData) return canvas;
  const out = document.createElement("canvas");
  out.width = canvas.width; out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(canvas, 0, 0);
  const img = await createImageBitmap(logoData);
  const w = out.width * .2, h = w * img.height / img.width, x = (out.width - w) / 2, y = (out.height - h) / 2;
  ctx.fillStyle = "#fff"; ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
  ctx.drawImage(img, x, y, w, h);
  return out;
}
const BC_HINT = { EAN13: "bc_hint_EAN13", EAN8: "bc_hint_EAN8", UPC: "bc_hint_UPC", ITF: "bc_hint_ITF", CODE128: "bc_hint_CODE128", CODE39: "bc_hint_CODE39" };
function updateGenUi() {
  const ty = $("genType").value, isQr = ty === "qr";
  $("qrOpts").classList.toggle("hidden", !isQr); $("logoField").classList.toggle("hidden", !isQr);
  $("bcOpts").classList.toggle("hidden", isQr); $("bcTextWrap").classList.toggle("hidden", isQr);
  $("bcHint").classList.toggle("hidden", isQr);
  if (!isQr) $("bcHint").textContent = t(BC_HINT[ty]);
}
$("genType").onchange = updateGenUi;
$("logoInput").onchange = e => { logoData = e.target.files[0] || null; $("logoName").textContent = logoData ? logoData.name : t("logo_none"); };
$("makeQr").onclick = async () => {
  const s = $("qrText").value.trim();
  if (!s) { toast(t("toast_need_text")); return; }
  const ty = $("genType").value;
  try {
    if (ty === "qr") {
      let level = $("qrLevel").value;
      if (logoData && (level === "L" || level === "M")) { level = "H"; $("qrLevel").value = "H"; toast(t("toast_ecc_logo")); }
      makeQr(s, $("qrOutput"), Number($("qrSize").value), level, $("qrDark").value, $("qrLight").value);
      const c = canvasOf($("qrOutput"));
      if (c && logoData) $("qrOutput").replaceChildren(await withLogo(c));
    } else {
      if (!window.JsBarcode) throw Error("JsBarcode lib");
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, s, { format: ty, width: Number($("bcWidth").value), height: Number($("bcHeight").value), displayValue: $("bcText").checked, margin: 14, lineColor: $("qrDark").value, background: $("qrLight").value, fontSize: 16 });
      $("qrOutput").replaceChildren(canvas);
    }
    $("downloadQr").disabled = false; $("copyQr").disabled = false;
    toast(t("toast_created"));
  } catch (e) {
    toast(ty === "qr" ? t("err_toolong") : t("err_barcode"));
  }
};
function downloadTarget(target, name) {
  const c = canvasOf(target);
  if (!c) return;
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png"); a.download = name; a.click();
}
$("downloadQr").onclick = () => downloadTarget($("qrOutput"), "leitor-qr-peppe.png");
$("copyQr").onclick = async () => {
  try {
    const c = canvasOf($("qrOutput")), blob = await new Promise(r => c.toBlob(r));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(t("toast_img_copied"));
  } catch { toast(t("toast_img_unsupported")); }
};

/* ================= Pix ================= */
$("pixKey").oninput = () => {
  const kind = C.pixKeyKind(C.normalizePixKey($("pixKey").value));
  $("pixKeyHint").textContent = kind ? t("pixkey_" + kind) : "";
};
$("makePix").onclick = () => {
  const key = C.normalizePixKey($("pixKey").value), name = $("pixName").value, city = $("pixCity").value;
  const amount = $("pixAmount").value, txid = $("pixTxid").value.trim() || "***";
  if (!key || !C.sanitizePixText(name, 25) || !C.sanitizePixText(city, 15)) { toast(t("pix_fill")); return; }
  if (amount && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) { toast(t("pix_amount_invalid")); return; }
  if (txid !== "***" && !/^[A-Za-z0-9]{1,25}$/.test(txid)) { toast(t("pix_txid_invalid")); return; }
  try {
    pixPayload = C.buildPix(key, name, city, amount, txid);
    const check = C.parsePix(pixPayload);
    if (!check || !check.crcOk) throw Error("pix self-check");
    makeQr(pixPayload, $("pixOutput"), 256, "M", "#000000", "#ffffff");
    $("pixPayload").textContent = pixPayload; $("pixPayload").classList.remove("hidden");
    $("copyPix").disabled = false; $("downloadPix").disabled = false;
    toast(t("pix_created"));
  } catch (e) { toast(String(e.message || e)); }
};
$("copyPix").onclick = () => copyText(pixPayload, t("pix_copied"));
$("downloadPix").onclick = () => downloadTarget($("pixOutput"), "pix-leitor-qr-peppe.png");

/* ================= Ajustes ================= */
function populateBank() {
  const sb = $("setBank");
  sb.replaceChildren(el("option", { value: "", text: t("set_bank_none") }));
  C.BANK_SITES.forEach(b => sb.append(el("option", { value: b.id, text: b.name })));
  sb.value = settings.bank || "";
}
$("setBank").onchange = e => { settings.bank = e.target.value; saveSettings(); if (current) renderExtra(currentInfo); };
function bindSettings() {
  $("setVoice").checked = settings.voice;
  $("setBeep").checked = settings.beep; $("setVibrate").checked = settings.vibrate;
  $("setAutoOpen").checked = settings.autoOpen; $("setAutoLookup").checked = settings.autoLookup; $("setGuide").checked = settings.guide;
  $("setRate").value = settings.rate; $("rateVal").textContent = Number(settings.rate).toFixed(2).replace(/0$/, "") + "×";
  $("scanMode").value = settings.mode; $("continuousToggle").checked = settings.continuous; $("batchToggle").checked = settings.batchMode;
  const noSynth = !synth;
  $("setVoice").disabled = $("setVoicePick").disabled = $("setRate").disabled = $("testVoice").disabled = noSynth;
  $("voiceBtn").classList.toggle("hidden", noSynth);
}
$("setVoice").onchange = e => { settings.voice = e.target.checked; saveSettings(); updateVoiceBtn(); if (settings.voice) { primeVoice(); say(t("say_voice_on")); } else if (synth) synth.cancel(); };
$("setBeep").onchange = e => { settings.beep = e.target.checked; saveSettings(); };
$("setVibrate").onchange = e => { settings.vibrate = e.target.checked; saveSettings(); };
$("setAutoOpen").onchange = e => { settings.autoOpen = e.target.checked; saveSettings(); };
$("setAutoLookup").onchange = e => { settings.autoLookup = e.target.checked; saveSettings(); };
$("setGuide").onchange = e => { settings.guide = e.target.checked; saveSettings(); if (running) startGuide(); };
$("setRate").oninput = e => { settings.rate = Number(e.target.value); $("rateVal").textContent = settings.rate.toFixed(2).replace(/0$/, "") + "×"; saveSettings(); };
$("setVoicePick").onchange = e => { if (e.target.value) settings.voices[lang] = e.target.value; else delete settings.voices[lang]; saveSettings(); updateVoiceUsing(); say(t("set_test_phrase")); };
$("testVoice").onclick = () => { const was = settings.voice; settings.voice = true; primeVoice(); say(t("set_test_phrase")); settings.voice = was; };
$("clearAll").onclick = () => {
  if (!confirm(t("set_clear_confirm"))) return;
  try { Object.keys(localStorage).filter(k => k.startsWith("peppe-")).forEach(k => localStorage.removeItem(k)); } catch {}
  historyItems = []; libraryItems = []; batch = C.newBatch(); lastBatch = null; expected = { items: [] }; buildExpectedMap(); $("invText").value = ""; settings = Object.assign({}, DEFAULTS, { voices: {} }); lang = "pt";
  $("language").value = lang; bindSettings(); applyI18n(); toast(t("set_cleared"));
};

/* ================= Lote (leitura em sequência) ================= */
let lastBatch = null;
const batchCount = () => Object.keys(batch.items).length;
const batchReads = () => Object.values(batch.items).reduce((n, x) => n + x.count, 0);
function saveBatch() { if (!jset("peppe-batch", batch)) toast(t("toast_storage_full")); }
function updateBatchTab() {
  const n = batchCount(), tab = document.querySelector('.tab[data-page="batch"]');
  if (tab) tab.textContent = t("tab_batch") + (n ? " (" + n + ")" : "");
}
function renderBatchBar() {
  $("batchBar").classList.toggle("hidden", !settings.batchMode);
  if (!settings.batchMode) return;
  $("batchBarCount").textContent = t("batch_bar", { n: batchCount(), r: batchReads() });
  const l = lastBatch;
  $("batchBarLast").textContent = l ? t("batch_last") + " " + kindLabel(l.info.kind) + " · " + l.item.value + (l.item.count > 1 ? " (" + t("batch_dup", { n: l.item.count }) + ")" : "") : "";
}
function batchChanged() { saveBatch(); updateBatchTab(); renderBatchBar(); if (!$("page-batch").classList.contains("hidden")) renderBatch(); }

function batchRead(text, fmt, quiet) {
  const r = C.batchAdd(batch, text, fmt);
  if (r.status === "full") { toast(t("batch_full")); if (!quiet) say(t("batch_full")); return; }
  const info = C.classify(text, fmt), a = C.assess(info), alarm = a.level === "warn" || a.level === "bad";
  lastBatch = { info, a, item: r.item };
  batchChanged();
  if (quiet) return;
  let inv = null;
  if (expectedMap.size && C.INV_KINDS.includes(info.kind)) {
    const k = C.invKey(text), total = Object.values(batch.items).filter(x => C.invKey(x.value) === k).reduce((n, x) => n + x.count, 0);
    inv = C.inventoryLookup(expectedMap, total, text);
  }
  const invAlarm = !!inv && (inv.status === "over" || inv.status === "extra"), loud = alarm || invAlarm;
  if (settings.vibrate) { try { navigator.vibrate?.(loud ? [200, 80, 200, 80, 200] : r.status === "dup" ? [60, 40, 60] : [70]); } catch {} }
  beep(loud ? 330 : inv && inv.status === "ok" ? 1040 : r.status === "dup" ? 520 : 880);
  let phrase;
  if (alarm) phrase = t("say_batch_alarm", { kind: kindLabel(info.kind) });
  else if (inv) phrase = inv.status === "extra" ? t("say_inv_extra") : inv.status === "ok" ? t("say_inv_done", { e: inv.expected }) : inv.status === "over" ? t("say_inv_over", { c: inv.counted, e: inv.expected }) : t("say_inv_progress", { c: inv.counted, e: inv.expected });
  else phrase = r.status === "dup" ? t("say_batch_dup", { n: r.item.count }) : String(batchCount());
  say(phrase);
}

function batchRowEl(row) {
  const { key, item, info, a } = row, d = info.data;
  const head = el("div", { class: "head" }, el("span", { class: "dot " + a.level }), el("span", { class: "tag", text: kindLabel(info.kind) }),
    item.format ? el("span", { class: "tag", text: C.formatLabel(item.format) }) : null);
  if ((info.kind === "boleto" || info.kind === "pix") && item.count > 1) head.append(pill("warn", t("batch_dup", { n: item.count })));
  const parts = [];
  if (info.kind === "boleto") { parts.push(fmtMoney(d.amount)); if (d.due) parts.push(t("lbl_due") + " " + fmtDate(d.due)); if (d.bankName) parts.push(d.bankName); }
  else if (info.kind === "pix") { if (d.amount) parts.push(fmtMoney(Number(d.amount))); if (d.name) parts.push(d.name); }
  else if (info.kind === "gtin" || info.kind === "isbn") parts.push(d.type);
  else if (info.kind === "url") parts.push(d.host);
  else if (info.kind === "wifi") parts.push(d.ssid);
  const why = a.reasons.find(r => r.level !== "ok");
  const set = n => { item.count = Math.max(1, n); item.last = new Date().toISOString(); batchChanged(); };
  const ctrl = el("div", { class: "ctrl" },
    el("div", { class: "qty" },
      el("button", { text: "−", "aria-label": t("qty_dec"), disabled: item.count <= 1 ? "" : null, onclick: () => set(item.count - 1) }),
      el("b", { text: String(item.count) }),
      el("button", { text: "+", "aria-label": t("qty_inc"), onclick: () => set(item.count + 1) })),
    el("button", { class: "small", text: t("view"), onclick: () => { showResult(item.value, false, item.format); go("read"); } }),
    el("button", { class: "small", text: "🗑", "aria-label": t("batch_remove"), onclick: () => { delete batch.items[key]; if (lastBatch && lastBatch.item === item) lastBatch = null; batchChanged(); } }));
  const box = el("div", { class: "batch-item" + (a.level === "bad" ? " is-bad" : a.level === "warn" ? " is-warn" : "") }, head, el("div", { class: "val", text: item.value }));
  if (parts.length) box.append(el("div", { class: "sub", text: parts.join(" · ") }));
  if (why) box.append(el("div", { class: "hint", text: t(why.key, why.params) }));
  box.append(ctrl);
  return box;
}
function renderBatch() {
  renderInventory();
  if (document.activeElement !== $("batchName")) $("batchName").value = batch.name || "";
  const now = new Date(), s = C.batchSummary(batch, now), rows = C.batchRows(batch, now);
  const tiles = [[s.distinct, t("bs_items")], [s.reads, t("bs_reads")], [fmtMoney(s.payTotal), t("bs_pay", { n: s.payCount })],
    [s.units, t("bs_units")], [s.alerts, t("bs_alerts")], [s.nextDue ? fmtDate(s.nextDue) : t("bs_none"), t("bs_due")]];
  $("batchStats").replaceChildren(...tiles.map(([b, l]) => el("div", { class: "stat" }, el("b", { text: String(b) }), el("span", { text: l }))));
  const warn = $("batchWarnings"); warn.replaceChildren();
  const box = (cls, msg) => warn.append(el("div", { class: "verdict " + cls }, el("b", { text: msg })));
  if (s.dups) box("warn", t("batch_warn_dups", { n: s.dups }));
  if (s.overdue) box("warn", t("batch_warn_overdue", { n: s.overdue }));
  if (s.bad) box("bad", t("batch_warn_bad", { n: s.bad }));
  const f = $("batchFilter").value, q = $("batchSearch").value.trim().toLowerCase();
  const shown = rows.filter(r => (f === "all" || (f === "alerts" && (r.a.level === "warn" || r.a.level === "bad")) || (f === "pay" && C.isPay(r)) || (f === "products" && C.isProduct(r)))
    && (!q || (r.item.value + " " + kindLabel(r.info.kind)).toLowerCase().includes(q)));
  const list = $("batchList"); list.replaceChildren();
  if (!shown.length) { list.append(el("p", { class: "hint", text: t("batch_empty") })); return; }
  shown.forEach(r => list.append(batchRowEl(r)));
}
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()); };
const batchText = () => C.batchRows(batch).map(r => r.item.count + "\t" + r.item.value).join("\n");
$("batchToggle").onchange = e => { settings.batchMode = e.target.checked; saveSettings(); renderBatchBar(); if (running) startHints(); };
$("batchOpen").onclick = () => go("batch");
$("batchName").oninput = e => { batch.name = e.target.value.slice(0, 60); saveBatch(); };
$("batchFilter").onchange = renderBatch;
$("batchSearch").oninput = renderBatch;
$("batchContinue").onclick = async () => { primeVoice(); await go("read"); startCamera(); };
$("batchCsv").onclick = () => downloadBlob(new Blob(["\ufeff" + C.batchToCsv(batch)], { type: "text/csv;charset=utf-8" }), "lote-leitor-qr-peppe-" + stamp() + ".csv");
$("batchJson").onclick = () => {
  const payload = { app: "leitor-qr-peppe", version: 5, exportedAt: new Date().toISOString(), batch: { name: batch.name, items: C.batchRows(batch).map(r => Object.assign({}, r.item, { kind: r.info.kind, verdict: r.a.level })) } };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "lote-leitor-qr-peppe-" + stamp() + ".json");
};
$("batchCopy").onclick = () => copyText(batchText(), t("batch_copied"));
$("batchShare").onclick = async () => { const txt = batchText(); if (navigator.share) { try { await navigator.share({ title: batch.name || "Leitor QR - Peppe", text: txt }); } catch {} } else copyText(txt, t("batch_copied")); };
$("batchSave").onclick = () => {
  let n = 0;
  C.batchRows(batch).forEach(r => {
    if (isSaved(r.item.value)) return;
    libraryItems.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), value: r.item.value, format: r.item.format, note: (batch.name || "Lote").slice(0, 120), savedAt: new Date().toISOString() });
    n++;
  });
  saveLibrary(); renderLibrary(); toast(t("batch_saved", { n }));
};
$("batchClear").onclick = () => {
  if (!batchCount() || !confirm(t("batch_clear_confirm"))) return;
  batch = C.newBatch(); lastBatch = null; batchChanged(); toast(t("batch_cleared"));
};

/* ================= Inventário (lista esperada x lote) ================= */
const stLabel = s => t("st_" + s);
const stLevel = s => (s === "ok" ? "ok" : "warn");
const signed = n => (n > 0 ? "+" : "") + n;
function saveExpected() { if (!jset("peppe-expected", expected)) toast(t("toast_storage_full")); }
function invRowEl(r) {
  const lvl = stLevel(r.status);
  const box = el("div", { class: "batch-item" + (lvl === "warn" ? " is-warn" : "") },
    el("div", { class: "head" }, el("span", { class: "dot " + lvl }), pill(lvl, stLabel(r.status))),
    el("div", { class: "val", text: r.code }));
  if (r.desc) box.append(el("div", { class: "sub", text: r.desc }));
  box.append(el("div", { class: "hint", text: t("inv_line", { e: r.expected, c: r.counted, d: signed(r.diff) }) }));
  return box;
}
function renderInventory() {
  const has = expected.items.length > 0;
  $("invStatus").textContent = has ? t("inv_status", { n: expected.items.length, u: expected.items.reduce((n, i) => n + i.qty, 0) }) + invNote : t("inv_status_none") + invNote;
  $("invCsv").disabled = !has; $("invClear").disabled = !has;
  const stats = $("invStats"), list = $("invList");
  stats.replaceChildren(); list.replaceChildren();
  if (!has) return;
  const rep = C.inventoryReport(batch, expected), T = rep.totals;
  [[T.expectedItems, t("is_expected")], [T.ok, t("is_ok")], [T.divergences, t("is_div")], [T.extra, t("is_extra")]]
    .forEach(([b, l]) => stats.append(el("div", { class: "stat" }, el("b", { text: String(b) }), el("span", { text: l }))));
  const rows = $("invShowOk").checked ? rep.rows : rep.rows.filter(r => r.status !== "ok");
  if (!rows.length) list.append(el("p", { class: "hint", text: t("inv_all_ok") }));
  rows.forEach(r => list.append(invRowEl(r)));
}
function applyExpectedText(txt) {
  const r = C.parseExpected(txt);
  invNote = "";
  if (r.errors.length) invNote += t("inv_errors", { e: r.errors.length, l: r.errors[0] });
  if (r.merged) invNote += t("inv_merged", { m: r.merged });
  if (r.truncated) invNote += t("inv_truncated");
  if (!r.items.length) { renderInventory(); toast(t("inv_invalid")); return; }
  expected = { items: r.items }; buildExpectedMap(); saveExpected(); renderInventory(); toast(t("inv_applied"));
}
$("invText").value = expected.items.map(i => [i.code, i.qty, i.desc].join(";")).join("\n");
$("invApply").onclick = () => { const v = $("invText").value; if (!v.trim()) { toast(t("inv_empty_input")); return; } applyExpectedText(v); };
$("invFile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (f.size > 1000000) { toast(t("inv_file_big")); return; }
  const txt = await f.text();
  $("invText").value = txt; applyExpectedText(txt);
};
$("invTemplate").onclick = () => downloadBlob(new Blob(["\ufeffcodigo;quantidade;descricao\r\n7891000100103;10;Leite integral 1L\r\nSKU-778;2;Parafuso sextavado\r\n"], { type: "text/csv;charset=utf-8" }), "modelo-lista-esperada.csv");
$("invClear").onclick = () => {
  if (!expected.items.length || !confirm(t("inv_clear_confirm"))) return;
  expected = { items: [] }; buildExpectedMap(); invNote = ""; $("invText").value = "";
  try { localStorage.removeItem("peppe-expected"); } catch {}
  renderInventory(); toast(t("inv_cleared"));
};
$("invShowOk").onchange = renderInventory;
$("invCsv").onclick = () => downloadBlob(new Blob(["\ufeff" + C.inventoryCsv(C.inventoryReport(batch, expected), batch.name)], { type: "text/csv;charset=utf-8" }), "conferencia-inventario-" + stamp() + ".csv");

/* ================= Relatório em PDF ================= */
const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(Error("load"));
    setTimeout(() => rej(Error("timeout")), 15000);
    document.head.append(s);
  });
}
async function getJsPdf() {
  if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript(JSPDF_URL);
  if (!(window.jspdf && window.jspdf.jsPDF)) throw Error("jspdf");
  return window.jspdf.jsPDF;
}
function buildReportSpec() {
  const now = new Date(), s = C.batchSummary(batch, now), rows = C.batchRows(batch, now);
  const num = new Map(rows.map((r, i) => [r.key, i + 1]));
  const lv = a => t("lvl_" + a.level), lvKey = a => (a.level === "info" ? undefined : a.level);
  const blocks = [
    { type: "title", title: t("pdf_title"), subtitle: t("pdf_batch", { n: batch.name || t("pdf_unnamed") }), meta: t("pdf_generated", { d: now.toLocaleString(LANGTAG[lang]) }) },
    { type: "heading", text: t("pdf_sec_summary") },
    { type: "kv", items: [
      { label: t("bs_items"), value: String(s.distinct) }, { label: t("bs_reads"), value: String(s.reads) },
      { label: t("bs_pay", { n: s.payCount }), value: fmtMoney(s.payTotal) }, { label: t("bs_units"), value: String(s.units) },
      { label: t("bs_alerts"), value: String(s.alerts) }, { label: t("bs_due"), value: s.nextDue ? fmtDate(s.nextDue) : t("bs_none") }] }
  ];
  if (s.dups) blocks.push({ type: "callout", level: "warn", text: t("batch_warn_dups", { n: s.dups }) });
  if (s.overdue) blocks.push({ type: "callout", level: "warn", text: t("batch_warn_overdue", { n: s.overdue }) });
  if (s.bad) blocks.push({ type: "callout", level: "bad", text: t("batch_warn_bad", { n: s.bad }) });

  const alerts = rows.filter(r => r.a.level === "warn" || r.a.level === "bad");
  if (alerts.length) blocks.push({ type: "heading", text: t("pdf_sec_alerts") + " (" + alerts.length + ")" },
    { type: "table", empty: t("pdf_empty"), cols: [{ title: t("col_num"), w: .07 }, { title: t("col_type"), w: .2 }, { title: t("col_status"), w: .16, level: true }, { title: t("col_reason"), w: .57, maxLines: 5 }],
      rows: alerts.map(r => ({ cells: [String(num.get(r.key)), kindLabel(r.info.kind), lv(r.a), r.a.reasons.filter(x => x.level !== "ok").map(x => t(x.key, x.params)).join(" ")], level: lvKey(r.a), sub: r.item.value })) });

  const pay = rows.filter(C.isPay);
  if (pay.length) blocks.push({ type: "heading", text: t("pdf_sec_pay") + " (" + pay.length + ")" },
    { type: "table", empty: t("pdf_empty"), cols: [{ title: t("col_num"), w: .06 }, { title: t("col_type"), w: .17 }, { title: t("col_party"), w: .26 }, { title: t("col_amount"), w: .14, align: "right" }, { title: t("col_due"), w: .13 }, { title: t("col_status"), w: .15, level: true }, { title: t("col_qty"), w: .09, align: "right" }],
      rows: pay.map(r => {
        const d = r.info.data, k = r.info.kind;
        const party = k === "boleto" ? (d.bank + " " + (d.bankName || "")).trim() : k === "pix" ? [d.name, d.city].filter(Boolean).join(" - ") : "-";
        const amount = k === "boleto" ? fmtMoney(d.amount) : k === "pix" && d.amount ? fmtMoney(Number(d.amount)) : "-";
        return { cells: [String(num.get(r.key)), kindLabel(k), party || "-", amount, k === "boleto" && d.due ? fmtDate(d.due) : "-", lv(r.a), String(r.item.count)], level: lvKey(r.a), sub: r.item.value };
      }) });

  const prod = rows.filter(C.isProduct);
  if (prod.length) blocks.push({ type: "heading", text: t("pdf_sec_products") + " (" + prod.length + ")" },
    { type: "table", empty: t("pdf_empty"), cols: [{ title: t("col_num"), w: .07 }, { title: t("col_code"), w: .36, mono: true, maxLines: 2 }, { title: t("col_type"), w: .18 }, { title: t("col_format"), w: .17 }, { title: t("col_status"), w: .13, level: true }, { title: t("col_qty"), w: .09, align: "right" }],
      rows: prod.map(r => ({ cells: [String(num.get(r.key)), r.item.value, kindLabel(r.info.kind), r.item.format ? C.formatLabel(r.item.format) : "-", lv(r.a), String(r.item.count)], level: lvKey(r.a) })) });

  const other = rows.filter(r => !C.isPay(r) && !C.isProduct(r));
  if (other.length) blocks.push({ type: "heading", text: t("pdf_sec_other") + " (" + other.length + ")" },
    { type: "table", empty: t("pdf_empty"), cols: [{ title: t("col_num"), w: .07 }, { title: t("col_type"), w: .3 }, { title: t("col_status"), w: .2, level: true }, { title: t("col_qty"), w: .1, align: "right" }, { title: t("col_format"), w: .33 }],
      rows: other.map(r => ({ cells: [String(num.get(r.key)), kindLabel(r.info.kind), lv(r.a), String(r.item.count), r.item.format ? C.formatLabel(r.item.format) : "-"], level: lvKey(r.a), sub: r.item.value })) });

  if (expected.items.length) {
    const rep = C.inventoryReport(batch, expected, now), T = rep.totals;
    blocks.push({ type: "heading", text: t("pdf_sec_inv") },
      { type: "kv", items: [{ label: t("is_expected"), value: String(T.expectedItems) }, { label: t("is_ok"), value: String(T.ok) }, { label: t("is_div"), value: String(T.divergences) },
        { label: t("bs_units"), value: T.countedUnits + " / " + T.expectedUnits }, { label: t("is_extra"), value: String(T.extra) }, { label: t("bs_reads"), value: String(T.countedUnits + T.extraUnits) }] },
      { type: "table", empty: t("pdf_empty"), cols: [{ title: t("col_code"), w: .27, mono: true, maxLines: 2 }, { title: t("col_desc"), w: .29 }, { title: t("col_expected"), w: .13, align: "right" }, { title: t("col_counted"), w: .13, align: "right" }, { title: t("col_status"), w: .18, level: true }],
        rows: rep.rows.map(r => ({ cells: [r.code, r.desc || "-", String(r.expected), String(r.counted), stLabel(r.status) + (r.diff ? " (" + signed(r.diff) + ")" : "")], level: stLevel(r.status) })) });
  }
  return { meta: { title: t("pdf_title") + " - " + (batch.name || t("pdf_unnamed")), subject: "Leitor QR - Peppe" },
    footer: { left: "Leitor QR - Peppe v" + APP_VERSION, disclaimer: t("pdf_disclaimer"), page: t("pdf_page", { p: "{p}", n: "{n}" }) }, blocks };
}
async function makePdfBlob() {
  const JsPDF = await getJsPdf();
  return window.PeppeReport.build(JsPDF, buildReportSpec()).output("blob");
}
const pdfName = () => "relatorio-lote-" + (C.stripAccents(batch.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lote") + "-" + stamp() + ".pdf";
async function runPdf(share) {
  if (!batchCount()) { toast(t("batch_empty")); return; }
  const btn = $(share ? "batchPdfShare" : "batchPdf");
  btn.disabled = true; toast(t("pdf_working"));
  try {
    const blob = await makePdfBlob();
    if (share) {
      const file = new File([blob], pdfName(), { type: "application/pdf" });
      try { await navigator.share({ files: [file], title: t("pdf_title") + " - " + (batch.name || "") }); } catch {}
    } else { downloadBlob(blob, pdfName()); toast(t("pdf_done")); }
  } catch (e) { console.warn("PDF", e); toast(t("pdf_fail")); }
  finally { btn.disabled = false; }
}
$("batchPdf").onclick = () => runPdf(false);
$("batchPdfShare").onclick = () => runPdf(true);
try { if (navigator.canShare && navigator.canShare({ files: [new File(["x"], "a.pdf", { type: "application/pdf" })] })) $("batchPdfShare").classList.remove("hidden"); } catch {}

/* ================= Navegação, tema, idioma, PWA ================= */
const PAGES = ["read", "generate", "pix", "stats", "batch", "library", "settings"];
async function go(page) {
  if (!PAGES.includes(page)) return;
  await stop(); cancelAuto(); if (synth) synth.cancel();
  document.querySelectorAll(".tab[data-page]").forEach(x => x.setAttribute("aria-selected", String(x.dataset.page === page)));
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $("page-" + page).classList.remove("hidden");
  updateStats();
  if (page === "batch") renderBatch();
}
document.querySelectorAll(".tab[data-page]").forEach(b => b.onclick = () => go(b.dataset.page));

function applyI18n() {
  document.documentElement.lang = LANGTAG[lang];
  document.querySelectorAll("[data-i18n]").forEach(e => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach(e => { e.placeholder = t(e.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-label]").forEach(e => { const v = t(e.dataset.i18nLabel); e.setAttribute("aria-label", v); e.title = v; });
  updateVoiceBtn(); populateVoiceSelect(); populateBank(); updateGenUi();
  updateBatchTab(); renderBatchBar(); if (!$("page-batch").classList.contains("hidden")) renderBatch();
  if (statusState) setStatus(statusState.key, statusState.params); else setStatus(running ? "cam_active" : "cam_idle");
  if (fileIdle) $("fileStatus").textContent = t("file_idle");
  if (!logoData) $("logoName").textContent = t("logo_none");
  renderHistory(); renderLibrary(); updateStats();
  if (current) showResult(current, false, currentFmt);
  if (running) $("torchBtn").textContent = t(torchOn ? "torch_off" : "torch");
  $("pixKey").oninput();
}
$("language").value = lang;
$("language").onchange = e => { lang = e.target.value; rawSet("peppe-lang", lang); applyI18n(); };

$("themeBtn").onclick = () => {
  document.documentElement.classList.toggle("light");
  rawSet("peppe-theme", document.documentElement.classList.contains("light") ? "light" : "dark");
};
if (rawGet("peppe-theme") === "light") document.documentElement.classList.add("light");

let installPrompt = null;
const doInstall = async () => {
  if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("installBtn").classList.add("hidden"); return; }
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const key = standalone ? "inst_done" : location.protocol === "file:" ? "inst_file" : ios ? "inst_ios" : "inst_manual";
  $("installHelp").textContent = t(key);
  toast(t(key));
};
$("installBtn").onclick = doInstall; $("installBtn2").onclick = doInstall;
window.addEventListener("appinstalled", () => { installPrompt = null; $("installBtn").classList.add("hidden"); toast(t("inst_done")); });
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; $("installBtn").classList.remove("hidden"); });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));

/* ================= Início ================= */
bindSettings();
if (synth) {
  loadVoices();
  if (synth.addEventListener) synth.addEventListener("voiceschanged", loadVoices);
  setTimeout(() => { if (!voices.length) loadVoices(); }, 1000);
}
applyI18n();
setCamUi(false);
const startAction = new URLSearchParams(location.search).get("action");
if (startAction && PAGES.includes(startAction)) go(startAction);
})();
