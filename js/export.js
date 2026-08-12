// Geração dos arquivos de saída (XLSX) com SheetJS.
const ExportModule = (() => {
  function statusDoItem(item) {
    if (item.quantidadeRecebida === 0 && item.quantidadeEsperada > 0) return "PENDENTE";
    if (item.quantidadeRecebida === item.quantidadeEsperada) return "OK";
    if (item.quantidadeRecebida < item.quantidadeEsperada) return "FALTA";
    return "SOBRA";
  }

  function safeName(str) {
    return (str || "sem_numero").toString().replace(/[^a-zA-Z0-9\-_]+/g, "_");
  }

  function exportRelatorioConferencia(session) {
    const rows = session.itens.map((item) => ({
      "Código": item.codigo,
      "EAN": item.ean,
      "Descrição": item.descricao,
      "Unidade": item.unidade,
      "Qtd. Esperada": item.quantidadeEsperada,
      "Qtd. Recebida": item.quantidadeRecebida,
      "Diferença": item.quantidadeRecebida - item.quantidadeEsperada,
      "Status": statusDoItem(item),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 40 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conferência");

    const filename = `conferencia_NF${safeName(session.numeroNF)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    return filename;
  }

  function exportControleLote(session) {
    const rows = (session.lotes || []).map((l) => ({
      "Produto": l.produto,
      "Código": l.codigo,
      "EAN": l.ean,
      "Lote": l.lote,
      "Data Fabricação": l.fabricacao,
      "Data Validade": l.validade,
      "Quantidade": l.quantidade,
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 40 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 12 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Controle de Lote");

    const filename = `controle_lote_NF${safeName(session.numeroNF)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    return filename;
  }

  return { exportRelatorioConferencia, exportControleLote, statusDoItem };
})();
