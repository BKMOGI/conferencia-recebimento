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

  // Caminhos absolutos: o worker do Tesseract carrega corePath/langPath de
  // dentro dele mesmo, então um caminho relativo ("./vendor/...") resolve
  // relativo à localização do PRÓPRIO worker (./vendor/worker.min.js), não
  // à página — duplicando "vendor/vendor/..." e quebrando o carregamento.
  const abs = (path) => new URL(path, document.baseURI).href;

  function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("por", 1, {
        workerPath: abs("./vendor/worker.min.js"),
        corePath: abs("./vendor/tesseract-core-simd.wasm.js"),
        langPath: abs("./vendor/lang"),
        gzip: true,
        logger: (m) => {
          if (activeProgressCallback) {
            const label = STATUS_LABELS[m.status] || m.status;
            activeProgressCallback(label, Math.round((m.progress || 0) * 100));
          }
        },
      }).then(async (worker) => {
        // PSM 4 = "single column, tamanhos de texto variados" — etiqueta tem
        // linhas de fontes bem diferentes (nome grande, campos pequenos,
        // código enorme em negrito) empilhadas numa coluna só. O modo
        // automático padrão estava confundindo/perdendo linhas inteiras
        // perto do código de barras e do número grande.
        await worker.setParameters({ tessedit_pageseg_mode: "4" });
        return worker;
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

  // Escala de cinza + esticamento de contraste (por percentil, mais robusto
  // que min/max puro contra reflexo/sombra). Técnica padrão pra melhorar
  // OCR em foto de etiqueta impressa — texto preto sobre fundo claro fica
  // bem mais nítido/definido pro Tesseract depois disso.
  function preprocessCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    const hist = new Array(256).fill(0);
    const gray = new Uint8ClampedArray(d.length / 4);

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      gray[p] = g;
      hist[g]++;
    }

    const total = gray.length;
    const lowCut = total * 0.02;
    const highCut = total * 0.98;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= lowCut) { lo = v; break; }
    }
    acc = 0;
    for (let v = 255; v >= 0; v--) {
      acc += hist[v];
      if (acc >= total - highCut) { hi = v; break; }
    }
    if (hi <= lo) { hi = 255; lo = 0; }

    const range = hi - lo;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      let v = ((gray[p] - lo) / range) * 255;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }

    ctx.putImageData(imgData, 0, 0);
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
    qtd: /(?:QTDE?|QUANT(?:IDADE)?)[^\d]{0,10}(\d{1,6})/i,
    anyDate: /\d{2}[\/\.\-]\d{2}[\/\.\-]\d{2,4}/g,
  };

  // O código de barras (GTIN) quase sempre tem 12-14 dígitos, e fica perto da
  // imagem do código de barras (normalmente no fim da etiqueta) — por isso
  // prioriza a ocorrência mais longa e mais ao final do texto. Números de 8
  // dígitos soltos são ambíguos com o código do produto (ex: "22093170"), então
  // só são tratados como EAN se não houver nenhum candidato mais longo.
  function extrairEan(text) {
    for (const len of [14, 13, 12]) {
      const re = new RegExp("\\b\\d{" + len + "}\\b", "g");
      const achados = text.match(re);
      if (achados && achados.length) return achados[achados.length - 1];
    }
    const oito = text.match(/\b\d{8}\b/g);
    if (oito && oito.length) return oito[oito.length - 1];
    return "";
  }

  function normalizeDate(d) {
    if (!d) return "";
    return d.replace(/[.\-]/g, "/");
  }

  // Palavras que marcam onde um campo conhecido começa numa linha. O OCR às
  // vezes junta o nome do produto com o campo seguinte numa linha só (ex:
  // "BOLO DE POTE BRIGADEIRO DATA DE FABRICAÇÃO: 18/07/2026") — em vez de
  // descartar a linha inteira, corta no início da palavra-chave e aproveita
  // o pedaço antes dela.
  const CAMPO_KEYWORD_RE = /\b(DATA\s+DE\s+FABRICA[ÇC][ÃA]O|FABRICA[ÇC][ÃA]O|LOTE|VALIDADE|VENCIMENTO|C[ÓO]DIGO|QTD|QUANTIDADE|CONGELADO|PESO\s+L[ÍI]QUIDO|GTIN)\b/i;

  function guessProductName(lines) {
    for (let line of lines) {
      let clean = line.trim();
      if (clean.length < 4) continue;
      if (/^\d+$/.test(clean)) continue;
      const corte = clean.match(CAMPO_KEYWORD_RE);
      if (corte && corte.index !== undefined) {
        clean = clean.slice(0, corte.index).trim();
      }
      if (clean.length < 4) continue;
      const letters = clean.replace(/[^A-Za-zÀ-ÿ]/g, "");
      if (letters.length >= 4) return clean;
    }
    return "";
  }

  // Muitas etiquetas mostram o código do produto como um número grande e
  // isolado, sem a palavra "código" do lado (ex: etiquetas da Bread King) —
  // às vezes até na mesma linha visual que "VALIDADE: dd/mm/aaaa", então não
  // dá pra exigir que ele esteja sozinho na linha. Em vez disso, procura por
  // qualquer "palavra" solta de 4 a 9 dígitos no texto todo (sem barras, sem
  // ser o EAN nem um valor já usado como lote/quantidade).
  function guessCodigoAvulso(text, excluir) {
    const tokens = text.split(/\s+/);
    for (const tok of tokens) {
      if (/^\d{4,9}$/.test(tok) && !excluir.includes(tok)) return tok;
    }
    return "";
  }

  function parseEtiqueta(rawText) {
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const text = rawText.replace(/\s+/g, " ");

    const lote = (text.match(RE.lote) || [])[1] || "";
    const fab = normalizeDate((text.match(RE.fab) || [])[1] || "");
    const val = normalizeDate((text.match(RE.val) || [])[1] || "");
    const ean = extrairEan(text);
    const qtd = (text.match(RE.qtd) || [])[1] || "";
    const produto = guessProductName(lines);

    let codigo = (text.match(RE.codigo) || [])[1] || "";
    if (!codigo) {
      codigo = guessCodigoAvulso(text, [lote, fab, val, ean, qtd].filter(Boolean));
    }

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
      quantidade: qtd ? parseFloat(qtd) : null,
      textoOriginal: rawText,
    };
  }

  // ---- Extração de itens de uma NF em PDF/foto (sem XML) ----
  //
  // O layout de tabela do DANFE é padronizado pela SEFAZ: cada item tem, nessa
  // ordem, NCM/SH (8 dígitos) · CST (3 dígitos) · CFOP (X.XXX) · Unidade ·
  // Quantidade. Isso vale pra praticamente qualquer emissor, não só um ERP
  // específico — por isso usamos essa sequência como "âncora" pra encontrar
  // onde cada item começa e termina, em vez de tentar ler célula por célula
  // (que varia muito de layout pra layout e falha fácil).
  const UNIDADES_NF = "PCT|CX|UN|KG|FD|CT|PC|DZ|LT|GL|SC|RL|MT|PAR";
  // Âncora no início de linha: no texto extraído, o código do produto sempre
  // começa uma linha nova. As linhas soltas de preço/imposto no meio são só
  // números — por isso exige (via lookahead, sem consumir) que exista uma
  // letra ainda na mesma linha do código, o que descarta essas linhas como
  // falso começo de item. A descrição em si é capturada de forma não-gulosa,
  // pois às vezes ela fica na mesma linha dos números da tabela, às vezes não.
  const ITEM_ANCHOR_RE = new RegExp(
    "^(\\d{2,10})[\\-\\d]*[ \\t]+(?=[^\\n]*[A-Za-zÀ-ÿ])([\\s\\S]{3,300}?)(\\d{8})\\s+(\\d{3})\\s+(\\d\\.?\\d{3})\\s+(" +
      UNIDADES_NF + ")\\s+([\\d.,]+)\\s+([\\d.,]+)",
    "gm"
  );

  function parseNumeroBR(str) {
    const n = parseFloat((str || "").replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }

  function limparDescricao(blob) {
    return blob
      .replace(/\n/g, " ")
      .split(/\bMVA\b/i)[0]
      .replace(/GTIN:?\s*\d{8,14}/i, "")
      .replace(/SEM\s+GTIN/i, "")
      .replace(/GTIN/i, "")
      .replace(/\d{2}\/\d{2}\/\d{2,4}/g, "")
      .replace(/-\d+\/[\d,]+/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function parseItensNF(rawText) {
    const text = rawText.replace(/[ \t]+/g, " ");
    const itens = [];
    let match;
    ITEM_ANCHOR_RE.lastIndex = 0;
    while ((match = ITEM_ANCHOR_RE.exec(text)) !== null) {
      const [, codigo, descBlob, , , , unidade, quantStr] = match;
      const eanMatch = descBlob.match(/GTIN:?\s*(\d{8,14})/i);
      const descricao = limparDescricao(descBlob);
      if (descricao.length < 3) continue;

      itens.push({
        id: `ocr_${itens.length + 1}`,
        codigo,
        ean: eanMatch ? eanMatch[1] : "",
        descricao,
        unidade,
        quantidadeEsperada: parseNumeroBR(quantStr),
        quantidadeRecebida: 0,
      });
    }
    return itens;
  }

  // Tenta achar o número da NF no texto (funciona pro PDF/foto — quando vem
  // de XML já temos isso certo via nfeParser).
  function parseNumeroNF(rawText) {
    const m = rawText.match(/N[ºo°]\.?:?\s*([\d.]{3,20})/i);
    if (!m) return "";
    const digits = m[1].replace(/\D/g, "").replace(/^0+/, "");
    return digits || m[1];
  }

  // ---- Renderiza uma página de PDF em canvas usando pdf.js (fallback OCR) ----

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

  // Extrai o texto real embutido no PDF (rápido e exato — sem OCR). A grande
  // maioria dos DANFE em PDF é gerada por um ERP e já tem essa camada de
  // texto; só cai pra OCR quando o PDF é uma foto/scan sem texto embutido.
  async function extractPdfText(arrayBuffer) {
    if (!window.pdfjsLib) throw new Error("pdf.js não carregado.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let lastY = null;
      let line = "";
      for (const item of content.items) {
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          fullText += line.trim() + "\n";
          line = "";
        }
        line += item.str + " ";
        lastY = y;
      }
      fullText += line.trim() + "\n";
    }
    return fullText;
  }

  return {
    recognize,
    parseEtiqueta,
    parseItensNF,
    parseNumeroNF,
    renderPdfPageToCanvas,
    extractPdfText,
    resizeToCanvas,
    preprocessCanvas,
    terminate,
  };
})();
