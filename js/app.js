// Estado, navegação entre telas e ligação dos eventos da interface.
(() => {
  let currentSession = null;
  let currentLabelData = null; // { produto, codigo, ean, lote, fabricacao, validade, quantidade, fotoDataUrl, matchedItemId }
  const screenStack = [];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showLoading(text) {
    $("#loading-text").textContent = text || "Processando…";
    $("#loading-overlay").hidden = false;
  }
  function hideLoading() {
    $("#loading-overlay").hidden = true;
  }
  function setLoadingText(text) {
    $("#loading-text").textContent = text;
  }

  function showScreen(id, title, push = true) {
    const current = $(".screen.active");
    if (push && current) screenStack.push({ id: current.id, title: $("#topbar-title").textContent });
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $(`#${id}`).classList.add("active");
    $("#topbar-title").textContent = title;
    $("#btn-back").hidden = screenStack.length === 0;
    window.scrollTo(0, 0);
  }

  function goBack() {
    const prev = screenStack.pop();
    if (!prev) return;
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $(`#${prev.id}`).classList.add("active");
    $("#topbar-title").textContent = prev.title;
    $("#btn-back").hidden = screenStack.length === 0;
    if (prev.id === "screen-conference") renderConference();
    if (prev.id === "screen-home") renderHome();
  }

  function newSessionId() {
    return `s_${Date.now()}`;
  }

  function fileToText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
  function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function dataUrlToImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // ---------- HOME ----------

  async function renderHome() {
    const sessions = await Db.listSessions();
    sessions.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
    const el = $("#lista-sessoes");
    if (sessions.length === 0) {
      el.innerHTML = '<p class="hint">Nenhuma conferência salva ainda.</p>';
      return;
    }
    el.innerHTML = sessions.map((s) => {
      const total = s.itens.length;
      const ok = s.itens.filter((i) => i.quantidadeRecebida === i.quantidadeEsperada).length;
      return `<div class="sessao-item" data-id="${s.id}">
        <div class="sessao-nf">NF ${s.numeroNF || "(sem número)"} — ${s.fornecedor || "sem fornecedor"}</div>
        <div class="sessao-meta">${ok}/${total} itens conferidos · ${new Date(s.criadoEm).toLocaleDateString("pt-BR")}</div>
      </div>`;
    }).join("");
    el.querySelectorAll(".sessao-item").forEach((node) => {
      node.addEventListener("click", async () => {
        currentSession = await Db.getSession(node.dataset.id);
        showScreen("screen-conference", `NF ${currentSession.numeroNF || ""}`, true);
        renderConference();
      });
    });
  }

  // ---------- IMPORTAR NF ----------

  function showImportStatus(msg, type) {
    const box = $("#import-status");
    box.hidden = false;
    box.textContent = msg;
    box.className = "status-box" + (type ? ` ${type}` : "");
  }

  async function ocrTextFromCanvas(canvas, label) {
    const small = OcrParser.resizeToCanvas(canvas);
    return OcrParser.recognize(small, (statusLabel, pct) => {
      setLoadingText(pct > 0 ? `${label}: ${statusLabel} (${pct}%)` : `${label}: ${statusLabel}…`);
    });
  }

  function startReviewFromItens(itens, numeroNF, fornecedor) {
    currentSession = {
      id: newSessionId(),
      numeroNF: numeroNF || "",
      fornecedor: fornecedor || "",
      criadoEm: new Date().toISOString(),
      itens: itens.map((it, idx) => ({ ...it, id: it.id || `item_${idx + 1}` })),
      lotes: [],
    };
    $("#input-numero-nf").value = currentSession.numeroNF;
    $("#input-fornecedor").value = currentSession.fornecedor;
    renderTabelaItensNF();
    showScreen("screen-review-nf", "Revisar itens da NF", true);
  }

  $("#input-xml").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      showLoading("Lendo XML da NFe…");
      const xml = await fileToText(file);
      const parsed = NfeParser.parse(xml);
      hideLoading();
      startReviewFromItens(parsed.itens, parsed.numeroNF, parsed.fornecedor);
    } catch (err) {
      hideLoading();
      showImportStatus("Erro ao ler o XML: " + err.message, "error");
    }
    e.target.value = "";
  });

  $("#input-pdf").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      showLoading("Abrindo PDF…");
      const buffer = await fileToArrayBuffer(file);
      const { canvas, numPages } = await OcrParser.renderPdfPageToCanvas(buffer, 1);
      setLoadingText("Lendo itens da NF (OCR)…");
      let text = await ocrTextFromCanvas(canvas, "Lendo página 1");
      for (let p = 2; p <= Math.min(numPages, 5); p++) {
        const { canvas: c2 } = await OcrParser.renderPdfPageToCanvas(buffer, p);
        text += "\n" + (await ocrTextFromCanvas(c2, `Lendo página ${p}`));
      }
      const itens = OcrParser.parseItensNF(text);
      hideLoading();
      if (itens.length === 0) {
        showImportStatus("Não consegui identificar itens automaticamente no PDF. Você pode adicionar os itens manualmente na próxima tela.", "error");
      }
      startReviewFromItens(itens, "", "");
    } catch (err) {
      hideLoading();
      showImportStatus("Erro ao processar o PDF: " + err.message, "error");
    }
    e.target.value = "";
  });

  $("#input-foto-nf").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      showLoading("Lendo a foto da NF (OCR)…");
      const dataUrl = await fileToDataUrl(file);
      const img = await dataUrlToImage(dataUrl);
      const text = await ocrTextFromCanvas(img, "Lendo NF");
      const itens = OcrParser.parseItensNF(text);
      hideLoading();
      if (itens.length === 0) {
        showImportStatus("Não consegui identificar itens automaticamente na foto. Você pode adicionar os itens manualmente na próxima tela.", "error");
      }
      startReviewFromItens(itens, "", "");
    } catch (err) {
      hideLoading();
      showImportStatus("Erro ao processar a foto: " + err.message, "error");
    }
    e.target.value = "";
  });

  $("#btn-manual").addEventListener("click", () => {
    startReviewFromItens([], "", "");
  });

  // ---------- REVISÃO DOS ITENS DA NF ----------

  function renderTabelaItensNF() {
    const el = $("#tabela-itens-nf");
    if (currentSession.itens.length === 0) {
      el.innerHTML = '<p class="hint">Nenhum item ainda. Use "Adicionar item".</p>';
      return;
    }
    el.innerHTML = currentSession.itens.map((item) => `
      <div class="item-card" data-id="${item.id}">
        <input type="text" class="f-descricao" placeholder="Descrição" value="${escapeAttr(item.descricao)}" style="margin-bottom:6px;" />
        <div style="display:flex; gap:6px; margin-bottom:6px;">
          <input type="text" class="f-codigo" placeholder="Código" value="${escapeAttr(item.codigo)}" />
          <input type="text" class="f-ean" placeholder="EAN" value="${escapeAttr(item.ean)}" />
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="number" class="f-qtd" placeholder="Qtd. esperada" value="${item.quantidadeEsperada}" step="0.01" style="flex:1;" />
          <input type="text" class="f-unid" placeholder="Un." value="${escapeAttr(item.unidade)}" style="width:60px;" />
        </div>
        <button class="btn-remove">Remover</button>
      </div>
    `).join("");

    el.querySelectorAll(".item-card").forEach((card) => {
      const id = card.dataset.id;
      const item = currentSession.itens.find((i) => i.id === id);
      card.querySelector(".f-descricao").addEventListener("input", (e) => item.descricao = e.target.value);
      card.querySelector(".f-codigo").addEventListener("input", (e) => item.codigo = e.target.value);
      card.querySelector(".f-ean").addEventListener("input", (e) => item.ean = e.target.value);
      card.querySelector(".f-qtd").addEventListener("input", (e) => item.quantidadeEsperada = parseFloat(e.target.value) || 0);
      card.querySelector(".f-unid").addEventListener("input", (e) => item.unidade = e.target.value);
      card.querySelector(".btn-remove").addEventListener("click", () => {
        currentSession.itens = currentSession.itens.filter((i) => i.id !== id);
        renderTabelaItensNF();
      });
    });
  }

  function escapeAttr(str) {
    return (str || "").toString().replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  $("#btn-add-item").addEventListener("click", () => {
    currentSession.itens.push({
      id: `item_${Date.now()}`,
      codigo: "", ean: "", descricao: "", unidade: "",
      quantidadeEsperada: 0, quantidadeRecebida: 0,
    });
    renderTabelaItensNF();
  });

  $("#btn-confirmar-nf").addEventListener("click", async () => {
    currentSession.numeroNF = $("#input-numero-nf").value.trim();
    currentSession.fornecedor = $("#input-fornecedor").value.trim();
    await Db.saveSession(currentSession);
    showScreen("screen-conference", `NF ${currentSession.numeroNF || ""}`, true);
    renderConference();
  });

  // ---------- CONFERÊNCIA ----------

  function statusOf(item) {
    return ExportModule.statusDoItem(item);
  }

  function renderConference() {
    const itens = currentSession.itens;
    const counts = { OK: 0, FALTA: 0, SOBRA: 0, PENDENTE: 0 };
    itens.forEach((i) => counts[statusOf(i)]++);

    $("#resumo-topo").innerHTML = `
      <div class="resumo-pill"><span class="n">${counts.OK}</span><span class="l">OK</span></div>
      <div class="resumo-pill"><span class="n">${counts.PENDENTE}</span><span class="l">Pendente</span></div>
      <div class="resumo-pill"><span class="n">${counts.FALTA}</span><span class="l">Falta</span></div>
      <div class="resumo-pill"><span class="n">${counts.SOBRA}</span><span class="l">Sobra</span></div>
    `;

    const el = $("#lista-itens-conferencia");
    el.innerHTML = itens.map((item) => {
      const st = statusOf(item);
      return `
      <div class="item-card status-${st.toLowerCase()}" data-id="${item.id}">
        <div class="item-desc">${escapeAttr(item.descricao) || "(sem descrição)"}</div>
        <div class="item-codigos">Cód: ${item.codigo || "-"} · EAN: ${item.ean || "-"}</div>
        <div class="item-qtd">
          <span>${item.quantidadeRecebida} / ${item.quantidadeEsperada} ${item.unidade || ""}</span>
          <span class="badge">${st}</span>
        </div>
        <div class="item-editable-qtd">
          <button class="qtd-menos">−</button>
          <input type="number" class="qtd-input" value="${item.quantidadeRecebida}" step="0.01" />
          <button class="qtd-mais">+</button>
        </div>
      </div>`;
    }).join("");

    el.querySelectorAll(".item-card").forEach((card) => {
      const id = card.dataset.id;
      const item = currentSession.itens.find((i) => i.id === id);
      const input = card.querySelector(".qtd-input");
      const commit = async () => {
        item.quantidadeRecebida = parseFloat(input.value) || 0;
        await Db.saveSession(currentSession);
        renderConference();
      };
      card.querySelector(".qtd-menos").addEventListener("click", () => {
        input.value = Math.max(0, (parseFloat(input.value) || 0) - 1);
        commit();
      });
      card.querySelector(".qtd-mais").addEventListener("click", () => {
        input.value = (parseFloat(input.value) || 0) + 1;
        commit();
      });
      input.addEventListener("change", commit);
    });
  }

  $("#btn-fotografar").addEventListener("click", () => {
    $("#input-foto-etiqueta").click();
  });

  $("#input-foto-etiqueta").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      showLoading("Lendo etiqueta (OCR)…");
      const dataUrl = await fileToDataUrl(file);
      const img = await dataUrlToImage(dataUrl);
      const text = await ocrTextFromCanvas(img, "Lendo etiqueta");
      const parsed = OcrParser.parseEtiqueta(text);
      hideLoading();

      currentLabelData = { ...parsed, fotoDataUrl: dataUrl };
      openReviewLabel();
    } catch (err) {
      hideLoading();
      alert("Erro ao processar a foto da etiqueta: " + err.message);
    }
    e.target.value = "";
  });

  function findMatch(labelData) {
    if (labelData.ean) {
      const m = currentSession.itens.find((i) => i.ean && i.ean === labelData.ean);
      if (m) return m;
    }
    if (labelData.codigo) {
      const m = currentSession.itens.find((i) => i.codigo && i.codigo === labelData.codigo);
      if (m) return m;
    }
    return null;
  }

  function openReviewLabel() {
    $("#label-foto-preview").src = currentLabelData.fotoDataUrl;
    $("#lbl-produto").value = currentLabelData.produto || "";
    $("#lbl-codigo").value = currentLabelData.codigo || "";
    $("#lbl-ean").value = currentLabelData.ean || "";
    $("#lbl-quantidade").value = currentLabelData.quantidade || 1;
    $("#lbl-lote").value = currentLabelData.lote || "";
    $("#lbl-fabricacao").value = currentLabelData.fabricacao || "";
    $("#lbl-validade").value = currentLabelData.validade || "";

    const status = $("#label-ocr-status");
    status.hidden = false;
    status.textContent = "Confira os campos abaixo — o OCR pode errar, corrija se precisar.";
    status.className = "status-box";

    updateMatchInfo();
    showScreen("screen-review-label", "Revisar etiqueta", true);
  }

  function updateMatchInfo() {
    const labelData = {
      ean: $("#lbl-ean").value.trim(),
      codigo: $("#lbl-codigo").value.trim(),
    };
    const match = findMatch(labelData);
    const box = $("#match-info");
    if (match) {
      box.className = "match-info matched";
      box.textContent = `✓ Encontrado na NF: ${match.descricao || match.codigo}`;
    } else {
      box.className = "match-info unmatched";
      box.textContent = "⚠ Não encontrado na NF — será adicionado como item extra (sobra).";
    }
  }

  ["lbl-ean", "lbl-codigo"].forEach((id) => {
    $(`#${id}`).addEventListener("input", updateMatchInfo);
  });

  $("#btn-confirmar-etiqueta").addEventListener("click", async () => {
    const produto = $("#lbl-produto").value.trim();
    const codigo = $("#lbl-codigo").value.trim();
    const ean = $("#lbl-ean").value.trim();
    const quantidade = parseFloat($("#lbl-quantidade").value) || 0;
    const lote = $("#lbl-lote").value.trim();
    const fabricacao = $("#lbl-fabricacao").value.trim();
    const validade = $("#lbl-validade").value.trim();

    let match = findMatch({ ean, codigo });
    if (match) {
      match.quantidadeRecebida = (match.quantidadeRecebida || 0) + quantidade;
      if (!match.ean && ean) match.ean = ean;
    } else {
      match = {
        id: `item_${Date.now()}`,
        codigo, ean, descricao: produto, unidade: "",
        quantidadeEsperada: 0, quantidadeRecebida: quantidade,
      };
      currentSession.itens.push(match);
    }

    currentSession.lotes.push({
      id: `lote_${Date.now()}`,
      produto: produto || match.descricao,
      codigo, ean, lote, fabricacao, validade, quantidade,
    });

    await Db.saveSession(currentSession);
    goBack();
  });

  $("#btn-descartar-etiqueta").addEventListener("click", () => {
    currentLabelData = null;
    goBack();
  });

  $("#btn-finalizar").addEventListener("click", () => {
    renderResumoFinal();
    showScreen("screen-summary", "Resumo da conferência", true);
  });

  // ---------- RESUMO / EXPORTAR ----------

  function renderResumoFinal() {
    const itens = currentSession.itens;
    const counts = { OK: 0, FALTA: 0, SOBRA: 0, PENDENTE: 0 };
    itens.forEach((i) => counts[statusOf(i)]++);
    $("#resumo-final").innerHTML = `
      <div class="card"><span class="n">${counts.OK}</span><span class="l">Itens OK</span></div>
      <div class="card"><span class="n">${counts.PENDENTE}</span><span class="l">Pendentes</span></div>
      <div class="card"><span class="n">${counts.FALTA}</span><span class="l">Faltando</span></div>
      <div class="card"><span class="n">${counts.SOBRA}</span><span class="l">A mais</span></div>
      <div class="card"><span class="n">${currentSession.lotes.length}</span><span class="l">Etiquetas registradas</span></div>
    `;
  }

  $("#btn-export-conferencia").addEventListener("click", () => {
    ExportModule.exportRelatorioConferencia(currentSession);
  });
  $("#btn-export-lote").addEventListener("click", () => {
    ExportModule.exportControleLote(currentSession);
  });
  $("#btn-voltar-conferencia").addEventListener("click", () => {
    goBack();
  });
  $("#btn-nova-conferencia-2").addEventListener("click", () => {
    currentSession = null;
    screenStack.length = 0;
    $("#btn-back").hidden = true;
    showImportStatusReset();
    showScreen("screen-import", "Nova conferência", false);
  });

  function showImportStatusReset() {
    const box = $("#import-status");
    box.hidden = true;
    box.textContent = "";
  }

  $("#btn-nova-conferencia").addEventListener("click", () => {
    currentSession = null;
    showImportStatusReset();
    showScreen("screen-import", "Nova conferência", true);
  });

  $("#btn-back").addEventListener("click", goBack);

  // ---------- INIT ----------

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  showScreen("screen-home", "Conferência de Recebimento", false);
  renderHome();
})();
