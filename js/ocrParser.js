// OCR (Tesseract.js) + extração por regex de campos da etiqueta / itens da NF.
const OcrParser = (() => {
  let workerPromise = null;

  const STATUS_LABELS = {
    "loading tesseract core": "Carregando motor de OCR",
    "initializing tesseract": "Iniciando OCR",
    "loading language traineddata": "Carregando idioma (1ª vez pode demorar)",
    "initializing api": "Preparando leitura",
    "recognizing text": "Lendo texto",
  };

  let activeProgressCallback = null;

  function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("por", 1, {
        workerPath: "./vendor/worker.min.js",
        corePath: "./vendor/tesseract-core-simd.wasm.js",
        langPath: "./vendor/lang",
        gzip: true,
        logger: (m) => {
          if (activeProgressCallback) {
            const label = STATUS_LABELS[m.status] || m.status;
            activeProgressCallback(label, Math.round((m.progress || 0) * 100));
          }
        },
      });
    }
    return workerPromise;
  }

  // Reduz a foto antes do OCR — fotos de câmera (ex: 4000x3000) deixam o
  // reconhecimento extremamente lento/instável em celulares. 1800px no maior
  // lado é suficiente para ler texto de etiqueta/DANFE sem travar o aparelho.
  function resizeToCanvas(imgOrCanvas, maxDim = 1800) {
    const srcW = imgOrCanvas.naturalWidth || imgOrCanvas.width;
    const srcH = imgOrCanvas.naturalHeight || imgOrCanvas.height;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    canvas.getContext("2d").drawImage(imgOrCanvas, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function recognize(imageSourceOrCanvas, onProgress) {
    const worker = await getWorker();
    activeProgressCallback = onProgress || null;
    try {
      const { data } = await worker.recognize(imageSourceOrCanvas);
      return data.text || "";
    } finally {
      activeProgressCallback = null;
    }
  }

  // Derruba o worker de OCR (usado pelo botão "Cancelar" caso algo trave) —
  // a próxima chamada a recognize() cria um worker novo do zero.
  async function terminate() {
    const pending = workerPromise;
    workerPromise = null;
    if (!pending) return;
    try {
      const worker = await pending;
      await worker.terminate();
    } catch (e) {
      // worker já pode estar travado/quebrado — ignora, um novo será criado na próxima OCR.
    }
  }

  // ---- Extração de campos da etiqueta de caixa ----

  const RE = {
    lote: /LOTE[\s.:º°]*([A-Z0-9\-\/]{2,20})/i,
    fab: /FAB(?:RICA[ÇC][ÃA]O)?[\s.:]*[\D]{0,3}(\d{2}[\/\.\-]\d{2}[\/\.\-]\d{2,4})/i,
    val: /(?:VAL(?:IDADE)?|VENC(?:IMENTO)?)[\s.:]*[\D]{0,3}(\d{2}[\/\.\-]\d{2}[\/\.\-]\d{2,4})/i,
    codigo: /C[ÓO]D(?:IGO)?[\s.:]*([A-Z0-9\-]{2,20})/i,
    qtd: /(?:QTD|QUANTIDADE)[\s.:]*(\d{1,6})/i,
    ean: /\b(\d{13}|\d{14}|\d{12}|\d{8})\b/,
    anyDate: /\d{2}[\/\.\-]\d{2}[\/\.\-]\d{2,4}/g,
  };

  function normalizeDate(d) {
    if (!d) return "";
    return d.replace(/[.\-]/g, "/");
  }

  function guessProductName(lines) {
    for (const line of lines) {
      const clean = line.trim();
      if (clean.length < 4) continue;
      if (/^\d+$/.test(clean)) continue;
      if (RE.lote.test(clean) || RE.fab.test(clean) || RE.val.test(clean) || RE.codigo.test(clean) || RE.qtd.test(clean)) continue;
      const letters = clean.replace(/[^A-Za-zÀ-ÿ]/g, "");
      if (letters.length >= 4) return clean;
    }
    return "";
  }

  function parseEtiqueta(rawText) {
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const text = rawText.replace(/\s+/g, " ");

    const lote = (text.match(RE.lote) || [])[1] || "";
    const fab = normalizeDate((text.match(RE.fab) || [])[1] || "");
    const val = normalizeDate((text.match(RE.val) || [])[1] || "");
    const codigo = (text.match(RE.codigo) || [])[1] || "";
    const qtd = (text.match(RE.qtd) || [])[1] || "";
    const ean = (text.match(RE.ean) || [])[1] || "";
    const produto = guessProductName(lines);

    // Se não achou FAB/VAL rotulados, tenta pegar as duas primeiras datas soltas do texto.
    let fabricacao = fab;
    let validade = val;
    if (!fabricacao && !validade) {
      const datas = (text.match(RE.anyDate) || []).map(normalizeDate);
      if (datas.length >= 1) fabricacao = datas[0];
      if (datas.length >= 2) validade = datas[1];
    }

    return {
      produto,
      codigo,
      ean,
      lote,
      fabricacao,
      validade,
      quantidade: qtd ? parseFloat(qtd) : 1,
      textoOriginal: rawText,
    };
  }

  // ---- Extração heurística de itens de uma NF em PDF/foto (sem XML) ----

  function parseItensNF(rawText) {
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const itens = [];

    for (const line of lines) {
      const numbers = line.match(/\d[\d.,]{1,}/g) || [];
      const eanMatch = line.match(/\b\d{13}\b/);
      const digitsOnly = numbers.filter((n) => /^\d+$/.test(n));
      const codigo = digitsOnly.find((n) => n.length >= 3 && n.length <= 8) || "";

      if (!codigo && !eanMatch) continue;

      const descricao = line
        .replace(eanMatch ? eanMatch[0] : "", "")
        .replace(/\d[\d.,]{2,}/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (descricao.length < 3) continue;

      const qtyCandidates = numbers.filter((n) => n !== (eanMatch && eanMatch[0]) && n !== codigo && parseFloat(n.replace(",", ".")) < 10000);
      const quantidade = qtyCandidates.length ? parseFloat(qtyCandidates[0].replace(",", ".")) : 0;

      itens.push({
        id: `ocr_${itens.length + 1}`,
        codigo: codigo || "",
        ean: eanMatch ? eanMatch[0] : "",
        descricao,
        unidade: "",
        quantidadeEsperada: quantidade,
        quantidadeRecebida: 0,
      });
    }

    return itens;
  }

  // ---- Renderiza uma página de PDF em canvas usando pdf.js ----

  async function renderPdfPageToCanvas(arrayBuffer, pageNumber = 1) {
    if (!window.pdfjsLib) throw new Error("pdf.js não carregado.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return { canvas, numPages: pdf.numPages };
  }

  return {
    recognize,
    parseEtiqueta,
    parseItensNF,
    renderPdfPageToCanvas,
    resizeToCanvas,
    terminate,
  };
})();
