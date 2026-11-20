const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const root = path.join(__dirname, "..");
const C = require(path.join(root, "core.js"));

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = html.replace(/<script src="https:[^>]*><\/script>/g, "").replace(/<link rel="stylesheet"[^>]*>/, "");
for (const f of ["core.js", "report.js", "i18n.js", "app.js"]) {
  const code = fs.readFileSync(path.join(root, f), "utf8").replace(/<\/script>/g, "<\\/script>");
  html = html.replace(`<script src="${f}"></script>`, `<script>${code}</script>`);
}

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", e => errors.push("jsdomError: " + (e.detail || e.message)));
vc.on("error", e => errors.push("console.error: " + e));

const spoken = [];
let decodeCb = null, startedWith = [];
const dom = new JSDOM(html, {
  url: "https://localhost/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.TextEncoder = TextEncoder; w.localStorage.setItem('peppe-lang','pt');
    class Html5Qrcode {
      constructor(id, opts) { this.id = id; this.opts = opts; }
      static async getCameras() { return [{ id: "cam-back", label: "Back camera" }, { id: "cam-front", label: "Front camera" }]; }
      async start(cam, cfg, ok) { startedWith.push({ cam, opts: this.opts }); decodeCb = ok; const b = cfg.qrbox(360, 270); if (!(b.width >= 50 && b.height >= 50)) throw Error("qrbox invalido"); }
      async stop() {} clear() {}
      getRunningTrackCameraCapabilities() {
        return {
          torchFeature: () => ({ isSupported: () => true, apply: async () => {} }),
          zoomFeature: () => ({ isSupported: () => true, min: () => 1, max: () => 4, step: () => .1, value: () => 1, apply: async () => {} })
        };
      }
      getRunningTrackSettings() { return { deviceId: "cam-back" }; }
      async applyVideoConstraints() {}
      async scanFileV2() { return { decodedText: "4006381333931", result: { format: { formatName: "EAN_13" } } }; }
    }
    w.Html5Qrcode = Html5Qrcode;
    w.Html5QrcodeSupportedFormats = Object.fromEntries([...C.F1D, ...C.F2D, "MAXICODE"].map((k, i) => [k, i]));
    // jsPDF simulado: registra os textos desenhados (o PDF real é validado em tests/report.test.js)
    w.__pdfTexts = [];
    w.jspdf = { jsPDF: class { constructor() { return new Proxy({}, { get: (_, k) => ({
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
      splitTextToSize: x => [String(x)], getTextWidth: () => 10, getNumberOfPages: () => 1,
      text: x => { w.__pdfTexts.push(Array.isArray(x) ? x.join(" ") : String(x)); },
      output: () => new w.Blob(["%PDF-1.3"], { type: "application/pdf" })
    })[k] || (() => undefined) }); } } };
    w.QRCode = function (el, o) { const c = w.document.createElement("canvas"); c.width = o.width; c.height = o.height; el.append(c); };
    w.QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
    w.JsBarcode = (canvas, text, o) => { if (o.format === "EAN13" && !/^\d{12,13}$/.test(text)) throw Error("invalid"); canvas.width = 300; canvas.height = 120; };
    class U { constructor(t) { this.text = t; } }
    w.SpeechSynthesisUtterance = U;
    const mk = (name, lang) => ({ name, lang, voiceURI: name, localService: false });
    w.speechSynthesis = {
      getVoices: () => [mk("Microsoft Francisca Online (Natural) - Portuguese (Brazil)", "pt-BR"), mk("Microsoft Thalita Online (Natural) - Portuguese (Brazil)", "pt-BR"), mk("Microsoft Duarte Online (Natural) - Portuguese (Portugal)", "pt-PT"), mk("Google US English", "en-US")],
      speak: u => spoken.push({ text: u.text, voice: u.voice && u.voice.name, lang: u.lang }),
      cancel() {}, addEventListener() {}
    };
    Object.defineProperty(w.navigator, "mediaDevices", { value: { getUserMedia: async () => ({}) } });
    w.navigator.vibrate = () => true;
    w.HTMLCanvasElement.prototype.getContext = () => null;
    const copied = (w.__copied = []); w.__opened = [];
    w.navigator.clipboard = { writeText: async t => { copied.push(t); } };
    w.open = u => { w.__opened.push(u); return null; };
    w.confirm = () => true; w.prompt = () => "minha nota";
    w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
    w.__downloads = []; w.HTMLAnchorElement.prototype.click = function () { w.__downloads.push(this.download); };
  }
});
const w = dom.window, d = w.document, $ = id => d.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0;
const check = (name, cond, extra) => { if (!cond) { console.log("  ✘", name, extra !== undefined ? "→ " + extra : ""); errors.push("FALHOU: " + name); } else { pass++; console.log("  ✔", name); } };
const lastSpoken = () => (spoken[spoken.length - 1] || {}).text || "";

(async () => {
  await sleep(1200);
  console.log("Inicialização");
  check("Voz preferida = Thalita (pt-BR, não pt-PT)", /Thalita/.test($("voiceUsing").textContent), $("voiceUsing").textContent);
  check("Textos PT aplicados", $("startBtn").textContent === "Iniciar câmera" && /Ler códigos/.test(d.querySelector('[data-page="read"]').textContent));
  check("Status inicial da câmera", /Permita o acesso/.test($("cameraStatus").textContent));

  console.log("Câmera");
  $("startBtn").click(); await sleep(150);
  check("Câmera iniciou (status ativo)", /Câmera ativa/.test($("cameraStatus").textContent), $("cameraStatus").textContent);
  check("Voz: 'Centralize o código'", spoken.some(s => /Centralize o código/.test(s.text) && /Thalita/.test(s.voice)), JSON.stringify(spoken));
  check("Botões lanterna / trocar câmera / zoom visíveis", !$("torchBtn").classList.contains("hidden") && !$("zoomWrap").classList.contains("hidden"));
  await sleep(50);
  check("Botão trocar câmera (2 câmeras)", !$("switchBtn").classList.contains("hidden"));
  check("Opções do scanner incluem formatsToSupport", Array.isArray(startedWith[0].opts.formatsToSupport) && startedWith[0].opts.formatsToSupport.length > 5);

  const pix = C.buildPix("teste@exemplo.com", "Maria", "Sao Paulo", "25.9", "***");
  decodeCb(pix, { result: { format: { formatName: "QR_CODE" } } }); await sleep(120);
  check("Pix: selo 'QR Code · Pix'", $("resultType").textContent === "QR Code · Pix", $("resultType").textContent);
  check("Pix: CRC válido exibido", /CRC válido/.test($("infoBox").textContent));
  check("Pix: voz com valor", /Pix lido\. Valor/.test(lastSpoken()) && /25,90/.test(lastSpoken()), lastSpoken());
  check("Câmera pausou após leitura", !running() && !$("startBtn").disabled);
  function running() { return $("stopBtn").disabled === false; }

  console.log("Modo barras + boleto");
  $("scanMode").value = "barcode"; $("scanMode").dispatchEvent(new w.Event("change")); $("startBtn").click(); await sleep(150);
  check("Reiniciou com formatos 1D", startedWith.length >= 2 && startedWith[startedWith.length - 1].opts.formatsToSupport.length === C.F1D.length);
  const days = Math.round((Date.UTC(2026, 11, 20) - Date.UTC(2025, 1, 22)) / 86400000);
  const sem = "2379" + String(1000 + days).padStart(4, "0") + "0000012345" + "1234567890123456789012345";
  const bar = sem.slice(0, 4) + C.mod11Boleto(sem.slice(0, 4) + sem.slice(4)) + sem.slice(4);
  decodeCb(bar, { result: { format: { formatName: "ITF" } } }); await sleep(120);
  check("Boleto reconhecido", /Boleto bancário/.test($("resultType").textContent), $("resultType").textContent);
  check("Boleto: valor e banco", /123,45/.test($("infoBox").textContent) && /Bradesco/.test($("infoBox").textContent), $("infoBox").textContent);
  check("Voz do boleto", /Boleto lido/.test(lastSpoken()), lastSpoken());

  console.log("Produto e link");
  $("startBtn").click(); await sleep(150);
  decodeCb("4006381333931", { result: { format: { formatName: "EAN_13" } } }); await sleep(30);
  check("EAN-13 como produto + botão consultar", /Produto/.test($("resultType").textContent) && !$("lookupBtn").classList.contains("hidden"), $("resultType").textContent);
  $("startBtn").click(); await sleep(150);
  decodeCb("http://192.168.0.5/login", { result: { format: { formatName: "QR_CODE" } } }); await sleep(120);
  check("Link suspeito: alertas no veredito", $("verdict").classList.contains("warn") && /Usa http/.test($("verdict").textContent) && /número de IP/.test($("verdict").textContent), $("verdict").textContent);
  check("Link suspeito: voz de atenção", /Atenção/.test(lastSpoken()), lastSpoken());
  check("Botão abrir habilitado", !$("openBtn").disabled);

  console.log("Wi-Fi");
  $("startBtn").click(); await sleep(150);
  decodeCb("WIFI:T:WPA;S:Casa;P:segredo;;", { result: { format: { formatName: "QR_CODE" } } }); await sleep(30);
  check("Wi-Fi: senha exibida + botão copiar senha", /segredo/.test($("infoBox").textContent) && /Copiar senha/.test($("extraActions").textContent));

  console.log("Leitura contínua");
  $("continuousToggle").checked = true; $("continuousToggle").dispatchEvent(new w.Event("change"));
  $("startBtn").click(); await sleep(150);
  decodeCb("AAA111", { result: { format: { formatName: "CODE_128" } } });
  decodeCb("AAA111", { result: { format: { formatName: "CODE_128" } } });
  decodeCb("BBB222", { result: { format: { formatName: "CODE_128" } } }); await sleep(30);
  check("Contínuo: repetido ignorado (2 leituras)", /2 lido/.test($("cameraStatus").textContent), $("cameraStatus").textContent);
  check("Contínuo: câmera segue ativa", running());
  $("stopBtn").click(); await sleep(30);

  console.log("Veredito, banco, edição, lanterna");
  $("startBtn").click(); await sleep(150);
  decodeCb(pix, { result: { format: { formatName: "QR_CODE" } } }); await sleep(120);
  check("Pix OK: veredito 'Conferido'", $("verdict").classList.contains("ok") && /Conferido/.test($("verdict").textContent), $("verdict").className);
  const bankBtn = () => [...d.querySelectorAll("#extraActions button")].find(b => /Copiar/.test(b.textContent));
  check("Botão 'Copiar para pagar' (sem banco escolhido)", !!bankBtn() && /Copiar para pagar/.test(bankBtn().textContent), $("extraActions").textContent);
  d.querySelector('[data-page="settings"]').click(); await sleep(30);
  $("setBank").value = "nubank"; $("setBank").dispatchEvent(new w.Event("change"));
  d.querySelector('[data-page="read"]').click(); await sleep(30);
  [...d.querySelectorAll("#historyList .history-item")].find(r => r.querySelector(".txt").textContent === pix).querySelector("button").click(); await sleep(30);
  check("Botão vira 'Copiar e abrir Nubank'", !!bankBtn() && /Copiar e abrir Nubank/.test(bankBtn().textContent), $("extraActions").textContent);
  bankBtn().click(); await sleep(80);
  check("Copiou o código Pix", w.__copied[w.__copied.length - 1] === pix);
  check("Abriu só o site oficial do Nubank", w.__opened[w.__opened.length - 1] === "https://nubank.com.br", JSON.stringify(w.__opened));
  check("Voz orienta Pix Copia e Cola", /Pix Copia e Cola/.test(lastSpoken()), lastSpoken());
  $("startBtn").click(); await sleep(150);
  decodeCb(pix.replace("25.90", "99.90"), { result: { format: { formatName: "QR_CODE" } } }); await sleep(120);
  check("Pix adulterado: veredito vermelho", $("verdict").classList.contains("bad") && /Não pague/.test($("verdict").textContent), $("verdict").className);
  check("Pix adulterado: sem botão de pagar", !bankBtn());
  check("Pix adulterado: voz de alerta", /Não pague/.test(lastSpoken()), lastSpoken());
  $("startBtn").click(); await sleep(150);
  decodeCb("https://nubank-atualiza.com/login", { result: { format: { formatName: "QR_CODE" } } }); await sleep(120);
  check("Link imitando banco: alerta de marca", $("verdict").classList.contains("warn") && /Nubank/.test($("verdict").textContent), $("verdict").textContent);
  check("Link imitando banco: voz", /imitar Nubank/.test(lastSpoken()), lastSpoken());
  $("startBtn").click(); await sleep(150);
  decodeCb("file:///C:/Users/ana/foto.png", { result: { format: { formatName: "QR_CODE" } } }); await sleep(120);
  check("file://: explicado e sem abrir", /Arquivo local/.test($("resultType").textContent) && /file:\/\//.test($("verdict").textContent) && $("openBtn").disabled, $("verdict").textContent);
  $("editBtn").click();
  check("Editar: caixa aberta com o texto", !$("editBox").classList.contains("hidden") && $("editText").value.startsWith("file://"));
  $("editText").value = "https://exemplo.com/corrigido"; $("editApply").click(); await sleep(30);
  check("Editar: reclassifica como link", /Link/.test($("resultType").textContent) && $("resultText").textContent === "https://exemplo.com/corrigido" && $("editBox").classList.contains("hidden"), $("resultType").textContent);
  check("Editar: histórico atualizado", [...d.querySelectorAll("#historyList .txt")].some(x => x.textContent === "https://exemplo.com/corrigido"));
  $("toGenBtn").click(); await sleep(30);
  check("Gerar QR deste texto abre o gerador preenchido", $("qrText").value === "https://exemplo.com/corrigido" && !$("page-generate").classList.contains("hidden"));
  d.querySelector('[data-page="read"]').click(); await sleep(30);
  check("Lanterna desabilitada com a câmera parada", $("torchBtn").disabled);
  $("startBtn").click(); await sleep(150);
  check("Lanterna habilitada com a câmera ativa", !$("torchBtn").disabled);
  $("torchBtn").click(); await sleep(30);
  check("Lanterna liga e muda o rótulo", /Desligar/.test($("torchBtn").textContent), $("torchBtn").textContent);
  $("stopBtn").click(); await sleep(30);

  console.log("Imagem");
  $("imageTab").click(); await sleep(30);
  const file = new w.File(["x"], "a.png", { type: "image/png" });
  w.createImageBitmap = async () => ({ width: 10, height: 10, close() {} });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(400) }), putImageData() {} });
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(["x"], { type: "image/png" })); };
  Object.defineProperty($("imageInput"), "files", { value: [file], configurable: true });
  $("imageInput").dispatchEvent(new w.Event("change")); await sleep(200);
  check("Imagem decodificada (EAN-13)", /Código encontrado/.test($("fileStatus").textContent) && /EAN-13/.test($("resultType").textContent), $("fileStatus").textContent + " | " + $("resultType").textContent);

  console.log("Gerador, Pix, biblioteca, ajustes");
  d.querySelector('[data-page="generate"]').click(); await sleep(30);
  $("genType").value = "EAN13"; $("genType").dispatchEvent(new w.Event("change"));
  check("Gerador: opções de barras visíveis, QR ocultas", $("qrOpts").classList.contains("hidden") && !$("bcOpts").classList.contains("hidden"));
  $("qrText").value = "789100010010"; $("makeQr").click(); await sleep(50);
  check("Código de barras gerado", !$("downloadQr").disabled && $("qrOutput").querySelector("canvas"));
  $("qrText").value = "abc"; $("makeQr").click(); await sleep(50);
  check("EAN-13 inválido mostra erro", /inválido/.test($("toast").textContent), $("toast").textContent);
  $("genType").value = "qr"; $("genType").dispatchEvent(new w.Event("change"));
  $("qrText").value = "https://exemplo.com"; $("makeQr").click(); await sleep(50);
  check("QR gerado", $("qrOutput").querySelector("canvas"));

  d.querySelector('[data-page="pix"]').click(); await sleep(30);
  $("pixKey").value = "(11) 98765-4321"; $("pixKey").dispatchEvent(new w.Event("input"));
  check("Dica de tipo de chave (telefone)", /telefone/.test($("pixKeyHint").textContent), $("pixKeyHint").textContent);
  $("pixName").value = "João"; $("pixCity").value = "São Paulo"; $("makePix").click(); await sleep(50);
  check("Pix gerado com acentos normalizados", /JOAO/.test($("pixPayload").textContent) && /SAO PAULO/.test($("pixPayload").textContent) && /\+5511987654321/.test($("pixPayload").textContent));

  d.querySelector('[data-page="read"]').click(); await sleep(30);
  $("saveCodeBtn").click();
  d.querySelector('[data-page="library"]').click(); await sleep(30);
  check("Biblioteca recebeu o item", d.querySelectorAll("#libraryList .history-item").length === 1);
  [...d.querySelectorAll("#libraryList button")].find(b => /Nota/.test(b.textContent)).click();
  check("Nota editável", /minha nota/.test($("libraryList").textContent));

  d.querySelector('[data-page="stats"]').click(); await sleep(30);
  check("Estatísticas calculadas", Number($("totalStat").textContent) >= 5 && $("formatBars").children.length > 0);

  d.querySelector('[data-page="settings"]').click(); await sleep(30);
  const opts = [...$("setVoicePick").options].map(o => o.textContent);
  check("Lista de vozes pt (3 itens: automática + 2 pt-BR + pt-PT = 4)", opts.length === 4 && !opts.some(o => /US English/.test(o)), JSON.stringify(opts));
  $("setVoicePick").value = "Microsoft Francisca Online (Natural) - Portuguese (Brazil)"; $("setVoicePick").dispatchEvent(new w.Event("change")); await sleep(120);
  check("Escolha manual de voz respeitada", /Francisca/.test($("voiceUsing").textContent) && /Francisca/.test(spoken[spoken.length - 1].voice), spoken[spoken.length - 1].voice);
  $("voiceBtn").click();
  check("Voz desligável", /desligada/.test($("voiceBtn").textContent));
  const n = spoken.length; $("voiceBtn").click(); $("voiceBtn").click();
  check("Silêncio quando desligada", spoken.length === n + 1, spoken.length - n);

  console.log("Lote");
  if (/desligada/.test($("voiceBtn").textContent)) $("voiceBtn").click();
  w.__blobs = []; w.URL.createObjectURL = b => { w.__blobs.push(b); return "blob:x"; };
  d.querySelector('[data-page="read"]').click(); await sleep(60);
  $("batchToggle").checked = true; $("batchToggle").dispatchEvent(new w.Event("change"));
  check("Barra do lote aparece", !$("batchBar").classList.contains("hidden"));
  $("startBtn").click(); await sleep(150);
  const QR = { result: { format: { formatName: "QR_CODE" } } }, ITF = { result: { format: { formatName: "ITF" } } }, EAN = { result: { format: { formatName: "EAN_13" } } };
  decodeCb(pix, QR); await sleep(120);
  check("1º código entra no lote e a câmera segue ativa", /1 itens · 1 leituras/.test($("batchBarCount").textContent) && !$("stopBtn").disabled, $("batchBarCount").textContent);
  check("Voz curta: só o número", lastSpoken() === "1", lastSpoken());
  check("Status 'Lote ativo'", /Lote ativo · 1 itens/.test($("cameraStatus").textContent), $("cameraStatus").textContent);
  decodeCb(pix, QR); await sleep(30);
  check("Mesmo código ainda na vista não conta de novo", /1 itens · 1 leituras/.test($("batchBarCount").textContent), $("batchBarCount").textContent);
  await sleep(1600); decodeCb(pix, QR); await sleep(120);
  check("Código que saiu da vista e voltou vira repetido (×2)", /1 itens · 2 leituras/.test($("batchBarCount").textContent) && /Repetido/.test(lastSpoken()), $("batchBarCount").textContent + " | " + lastSpoken());
  decodeCb(bar, ITF); decodeCb(C.barcodeToLinha(bar), ""); await sleep(120);
  check("Boleto em barras e em linha digitável = mesmo item", /2 itens · 4 leituras/.test($("batchBarCount").textContent), $("batchBarCount").textContent);
  decodeCb("4006381333931", EAN); await sleep(1600); decodeCb("4006381333931", EAN); await sleep(1600); decodeCb("4006381333931", EAN); await sleep(60);
  decodeCb(pix.replace("25.90", "99.90"), QR); await sleep(120);
  check("Item adulterado soa alarme falado", /Atenção/.test(lastSpoken()), lastSpoken());
  check("Barra mostra o último lido", /Pix/.test($("batchBarLast").textContent) && /Último/.test($("batchBarLast").textContent), $("batchBarLast").textContent);

  d.querySelector('[data-page="batch"]').click(); await sleep(60);
  check("Aba mostra o contador (Lote (4))", /Lote \(4\)/.test(d.querySelector('[data-page="batch"]').textContent), d.querySelector('[data-page="batch"]').textContent);
  const tile = label => [...d.querySelectorAll("#batchStats .stat")].find(x => x.textContent.includes(label));
  check("Totais: 4 itens, 8 leituras", /^4/.test(tile("Itens").textContent) && /^8/.test(tile("Leituras").textContent), $("batchStats").textContent);
  check("Total a pagar = Pix 25,90 + boleto 123,45 (adulterado fora)", /149,35/.test(tile("Total a pagar").textContent) && /\(2\)/.test(tile("Total a pagar").textContent), tile("Total a pagar").textContent);
  check("Unidades de produtos = 3", /^3/.test(tile("Unidades").textContent), tile("Unidades").textContent);
  check("Próximo vencimento = 20/12/2026", /20\/12\/2026/.test(tile("Próximo vencimento").textContent), tile("Próximo vencimento").textContent);
  check("Aviso de risco de pagamento em duplicidade", /2 cobrança\(s\) lida\(s\) mais de uma vez/.test($("batchWarnings").textContent), $("batchWarnings").textContent);
  check("Aviso de item bloqueado", /1 item\(ns\) com bloqueio/.test($("batchWarnings").textContent));
  const setFilter = async v => { $("batchFilter").value = v; $("batchFilter").dispatchEvent(new w.Event("change")); await sleep(20); return d.querySelectorAll("#batchList .batch-item").length; };
  check("Filtro 'Só com alerta' = 1 (vermelho)", (await setFilter("alerts")) === 1 && !!d.querySelector("#batchList .is-bad"));
  check("Filtro 'Boletos e Pix' = 3", (await setFilter("pay")) === 3);
  check("Filtro 'Produtos' = 1", (await setFilter("products")) === 1);
  check("Filtro 'Todos' = 4", (await setFilter("all")) === 4);
  const ean = () => [...d.querySelectorAll("#batchList .batch-item")].find(x => x.textContent.includes("4006381333931"));
  [...ean().querySelectorAll(".qty button")].find(b => b.textContent === "+").click(); await sleep(20);
  check("Quantidade + : EAN vai a 4", ean().querySelector(".qty b").textContent === "4");
  [...ean().querySelectorAll(".qty button")].find(b => b.textContent === "−").click(); await sleep(20);
  check("Quantidade − : volta a 3", ean().querySelector(".qty b").textContent === "3");
  check("Item duplicado de cobrança mostra selo 'lido 2×'", /lido 2×/.test($("batchList").textContent));

  $("batchCsv").click(); $("batchJson").click(); await sleep(20);
  check("CSV e JSON exportados", w.__blobs.length === 2 && /text\/csv/.test(w.__blobs[0].type) && /json/.test(w.__blobs[1].type) && w.__blobs[0].size > 100, JSON.stringify(w.__blobs.map(b => [b.type, b.size])));
  $("batchCopy").click(); await sleep(30);
  check("Copiar tudo: 'quantidade<TAB>código'", w.__copied[w.__copied.length - 1].includes("3\t4006381333931"), w.__copied[w.__copied.length - 1]);
  $("batchSave").click(); await sleep(30);
  check("Salvar na biblioteca avisa quantos", /código\(s\) salvo\(s\) na biblioteca/.test($("toast").textContent), $("toast").textContent);
  check("Lote persistido no armazenamento local", Object.keys(JSON.parse(w.localStorage.getItem("peppe-batch")).items).length === 4);

  d.querySelector("#batchList .is-bad .head");
  [...d.querySelectorAll("#batchList .batch-item")].find(x => x.classList.contains("is-bad")).querySelector('button[aria-label="Remover do lote"]').click(); await sleep(20);
  check("Remover item bloqueado tira o aviso vermelho", d.querySelectorAll("#batchList .batch-item").length === 3 && !/bloqueio/.test($("batchWarnings").textContent));

  console.log("Lote: várias leituras por imagem");
  d.querySelector('[data-page="read"]').click(); await sleep(30);
  $("imageTab").click(); await sleep(30);
  w.BarcodeDetector = class { async detect() { return [{ rawValue: "ABC123", format: "code_128" }, { rawValue: "https://exemplo.com/x", format: "qr_code" }]; } };
  const f2 = new w.File(["x"], "b.png", { type: "image/png" });
  Object.defineProperty($("imageInput"), "files", { value: [f2], configurable: true });
  $("imageInput").dispatchEvent(new w.Event("change")); await sleep(200);
  check("Imagem com 2 códigos entra no lote (3 → 5 itens)", /2 códigos encontrados/.test($("fileStatus").textContent) && /Lote: 5 itens/.test($("batchBarCount").textContent), $("fileStatus").textContent + " | " + $("batchBarCount").textContent);
  $("batchToggle").checked = false; $("batchToggle").dispatchEvent(new w.Event("change"));
  Object.defineProperty($("imageInput"), "files", { value: [f2], configurable: true });
  $("imageInput").dispatchEvent(new w.Event("change")); await sleep(200);
  check("Fora do lote: mostra o 1º e avisa dos outros", /Ative o Modo lote/.test($("fileStatus").textContent) && /ABC123/.test($("resultText").textContent), $("fileStatus").textContent);
  delete w.BarcodeDetector;

  d.querySelector('[data-page="batch"]').click(); await sleep(30);
  $("batchClear").click(); await sleep(30);
  check("Novo lote apaga tudo e zera o contador da aba", d.querySelectorAll("#batchList .batch-item").length === 0 && !/\(/.test(d.querySelector('[data-page="batch"]').textContent));
  check("Lote vazio mostra a dica", /Nenhum item no lote/.test($("batchList").textContent));

  console.log("Inventário e PDF");
  d.querySelector('[data-page="read"]').click(); await sleep(60);
  $("batchToggle").checked = true; $("batchToggle").dispatchEvent(new w.Event("change"));
  d.querySelector('[data-page="batch"]').click(); await sleep(60);
  $("invText").value = "codigo;quantidade;descricao\n4006381333931;3;Chocolate ao leite\nSKU-778;2;Parafuso\n7891000100103;1\nabc;xx";
  $("invApply").click(); await sleep(30);
  check("Lista aplicada: 3 itens, 6 unidades, 1 linha ignorada", /Lista carregada: 3 itens, 6 unidades/.test($("invStatus").textContent) && /1 linha\(s\) ignorada\(s\)/.test($("invStatus").textContent), $("invStatus").textContent);
  const invTile = label => [...d.querySelectorAll("#invStats .stat")].find(x => x.textContent.includes(label));
  check("Sem leituras: 3 divergências (não lidos)", /^3/.test(invTile("Divergências").textContent) && d.querySelectorAll("#invList .batch-item").length === 3 && /Não lido/.test($("invList").textContent), $("invStats").textContent);
  check("Lista persistida", JSON.parse(w.localStorage.getItem("peppe-expected")).items.length === 3);
  d.querySelector('[data-page="read"]').click(); await sleep(30);
  $("startBtn").click(); await sleep(150);
  const E13 = { result: { format: { formatName: "EAN_13" } } }, E8 = { result: { format: { formatName: "EAN_8" } } };
  decodeCb("4006381333931", E13); await sleep(120);
  check("Voz: '1 de 3'", lastSpoken() === "1 de 3", lastSpoken());
  await sleep(1600); decodeCb("4006381333931", E13); await sleep(120);
  check("Voz: '2 de 3'", lastSpoken() === "2 de 3", lastSpoken());
  await sleep(1600); decodeCb("4006381333931", E13); await sleep(120);
  check("Voz: 'Completo. 3 de 3.'", /Completo\. 3 de 3/.test(lastSpoken()), lastSpoken());
  decodeCb("96385074", E8); await sleep(120);
  check("Voz: 'Fora da lista.'", /Fora da lista/.test(lastSpoken()), lastSpoken());
  await sleep(1600); decodeCb("4006381333931", E13); await sleep(120);
  check("Voz: 'Sobra. 4 de 3.'", /Sobra\. 4 de 3/.test(lastSpoken()), lastSpoken());
  d.querySelector('[data-page="batch"]').click(); await sleep(60);
  check("Divergências: sobra + 2 não lidos + fora da lista = 4", /^4/.test(invTile("Divergências").textContent) && /^1/.test(invTile("Fora da lista").textContent), $("invStats").textContent);
  check("Linhas de divergência com situação em texto", /Sobra/.test($("invList").textContent) && /Fora da lista/.test($("invList").textContent) && /Esperado 3 · Contado 4 · Diferença \+1/.test($("invList").textContent), $("invList").textContent);
  const eanRow = [...d.querySelectorAll("#batchList .batch-item")].find(x => x.textContent.includes("4006381333931"));
  [...eanRow.querySelectorAll(".qty button")].find(b => b.textContent === "−").click(); await sleep(30);
  check("Ajustar quantidade para 3 confere o item", /^1/.test(invTile("Conferidos").textContent) && /^3/.test(invTile("Divergências").textContent), $("invStats").textContent);
  $("invShowOk").checked = true; $("invShowOk").dispatchEvent(new w.Event("change"));
  check("Mostrar conferidos inclui o item OK", /Conferido/.test($("invList").textContent) && d.querySelectorAll("#invList .batch-item").length === 4);
  const nBlobs = w.__blobs.length;
  $("invCsv").click(); $("invTemplate").click(); await sleep(20);
  check("CSV da conferência e modelo baixados", w.__blobs.length === nBlobs + 2 && w.__downloads.includes("modelo-lista-esperada.csv") && w.__downloads.some(x => /^conferencia-inventario-/.test(x)), JSON.stringify(w.__downloads));

  $("batchName").value = "Estoque - Corredor 3"; $("batchName").dispatchEvent(new w.Event("input"));
  w.__downloads.length = 0; w.__pdfTexts.length = 0;
  $("batchPdf").click(); await sleep(250);
  check("PDF baixado com nome do lote", w.__downloads.length === 1 && /^relatorio-lote-estoque-corredor-3-\d{8}-\d{4}\.pdf$/.test(w.__downloads[0]), JSON.stringify(w.__downloads));
  const pdfTxt = w.__pdfTexts.join(" | ");
  check("PDF: título, lote e resumo", /Relatório de lote/.test(pdfTxt) && /Estoque - Corredor 3/.test(pdfTxt) && /Resumo/.test(pdfTxt), pdfTxt.slice(0, 200));
  check("PDF: conferência de inventário com situação em texto", /Conferência de inventário/.test(pdfTxt) && /Chocolate ao leite/.test(pdfTxt) && /Não lido \(-2\)/.test(pdfTxt) && /Fora da lista \(\+1\)/.test(pdfTxt), pdfTxt.slice(-400));
  check("PDF: rodapé com aviso e paginação", /não substitui a conferência/.test(pdfTxt) && /Página 1 de 1/.test(pdfTxt));
  check("Botão de PDF reabilitado após gerar", !$("batchPdf").disabled);

  $("invClear").click(); await sleep(30);
  check("Limpar lista apaga e avisa", /Nenhuma lista carregada/.test($("invStatus").textContent) && $("invText").value === "" && w.localStorage.getItem("peppe-expected") === null, $("invStatus").textContent);
  $("batchClear").click(); await sleep(30);
  w.__downloads.length = 0; $("batchPdf").click(); await sleep(150);
  check("PDF com lote vazio não gera arquivo", w.__downloads.length === 0 && /Nenhum item no lote/.test($("toast").textContent), $("toast").textContent);
  $("batchToggle").checked = false; $("batchToggle").dispatchEvent(new w.Event("change"));

  console.log("Guia visual e motor alternativo");
  {
    if (running()) { $("stopBtn").click(); await sleep(50); }
    for (const id of ["continuousToggle", "batchToggle"]) if ($(id).checked) { $(id).checked = false; $(id).dispatchEvent(new w.Event("change")); }
    let clock = Date.now(); const realNow = w.Date.now; w.Date.now = () => clock;
    const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
    let detections = [{ rawValue: "4006381333931", format: "ean_13", cornerPoints: sq(100, 100, 300) }];
    w.BarcodeDetector = class { static async getSupportedFormats() { return ["qr_code", "ean_13", "code_128", "itf"]; } async detect() { return detections; } };
    const before = spoken.length;
    $("startBtn").click(); await sleep(150);
    const v = d.createElement("video"); Object.defineProperty(v, "readyState", { value: 4 }); Object.defineProperty(v, "videoWidth", { value: 640 }); Object.defineProperty(v, "videoHeight", { value: 480 });
    $("reader").append(v);
    await sleep(260);
    check("Guia: câmera ativa e canvas presente", running() && !!$("guide"));
    check("Guia: orientação 'Código à vista' em texto", /Código à vista/.test($("cameraStatus").textContent), $("cameraStatus").textContent);
    for (let i = 1; i <= 3; i++) { clock += 4100; await sleep(200); }
    check("Troca automática após 3 falhas: aviso por voz", spoken.slice(before).some(s => /modo alternativo/i.test(s.text)), JSON.stringify(spoken.slice(before).map(s => s.text)));
    clock += 200; await sleep(300);
    check("Motor alternativo leu o código (EAN-13)", /4006381333931/.test($("resultText").value || $("resultText").textContent), $("resultText").value);
    check("Motor alternativo: câmera pausou após leitura", !running());
    detections = [{ rawValue: "X", format: "qr_code", cornerPoints: sq(10, 10, 40) }];
    $("startBtn").click(); await sleep(400);
    check("Guia: código pequeno pede 'Aproxime'", /Aproxime a câmera/.test($("cameraStatus").textContent), $("cameraStatus").textContent);
    $("stopBtn").click(); await sleep(50);
    delete w.BarcodeDetector; w.Date.now = realNow;
  }

  console.log("Idiomas");
  for (const l of ["en", "es", "pt"]) {
    $("language").value = l; $("language").dispatchEvent(new w.Event("change")); await sleep(20);
    check("Idioma " + l + " aplicado sem erros", d.documentElement.lang === { pt: "pt-BR", en: "en-US", es: "es-ES" }[l] && $("startBtn").textContent.length > 3, $("startBtn").textContent);
  }

  console.log("\n" + pass + " verificações OK");
  if (errors.length) { console.log("\nERROS:\n" + errors.join("\n")); process.exit(1); }
  console.log("Sem erros de execução.");
  process.exit(0);
})().catch(e => { console.log("EXCEÇÃO no teste:", e); process.exit(2); });
