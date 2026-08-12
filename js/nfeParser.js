// Parse do XML da NFe (padrão SEFAZ) para extrair a lista de itens esperados.
const NfeParser = (() => {
  function text(el, tag) {
    const node = el.getElementsByTagName(tag)[0];
    return node ? node.textContent.trim() : "";
  }

  function parse(xmlString) {
    const doc = new DOMParser().parseFromString(xmlString, "application/xml");

    const parserError = doc.getElementsByTagName("parsererror")[0];
    if (parserError) {
      throw new Error("XML inválido ou corrompido.");
    }

    const infNFe = doc.getElementsByTagName("infNFe")[0];
    if (!infNFe) {
      throw new Error("Não parece ser um XML de NFe (tag infNFe não encontrada).");
    }

    const ide = doc.getElementsByTagName("ide")[0];
    const emit = doc.getElementsByTagName("emit")[0];

    const numeroNF = ide ? text(ide, "nNF") : "";
    const fornecedor = emit ? text(emit, "xNome") : "";

    const detNodes = Array.from(doc.getElementsByTagName("det"));
    if (detNodes.length === 0) {
      throw new Error("Nenhum item (tag det/prod) encontrado no XML.");
    }

    const itens = detNodes.map((det, idx) => {
      const prod = det.getElementsByTagName("prod")[0];
      if (!prod) return null;

      const cEAN = text(prod, "cEAN");
      const cEANTrib = text(prod, "cEANTrib");
      const ean = cEAN && cEAN !== "SEM GTIN" ? cEAN : (cEANTrib && cEANTrib !== "SEM GTIN" ? cEANTrib : "");

      return {
        id: `item_${idx + 1}`,
        codigo: text(prod, "cProd"),
        ean: ean,
        descricao: text(prod, "xProd"),
        unidade: text(prod, "uCom"),
        quantidadeEsperada: parseFloat(text(prod, "qCom") || "0"),
        quantidadeRecebida: 0,
      };
    }).filter(Boolean);

    return { numeroNF, fornecedor, itens };
  }

  return { parse };
})();
