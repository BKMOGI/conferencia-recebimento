// Lê o "Relatório de GTIN" (catálogo de código de barras por unidade e por
// caixa/fardo) exportado do sistema da empresa, em PDF, e monta uma tabela
// de busca: código de barras -> produto + quantas unidades tem numa caixa.
const CatalogParser = (() => {
  // Cada bloco de produto no relatório:
  //   PRODUTO: <codigo> - <descrição>
  //    <GTIN 13 dígitos> ... NÃO ...                <- unidade avulsa
  //   <DUN 14 dígitos><uni 1-3 dígitos, colado ou não> NÃO ... <- caixa/fardo
  //
  // O texto extraído do PDF cola colunas próximas sem espaço em boa parte do
  // relatório (ex: "178997691033258" = DUN "17899769103325" + uni "8"
  // grudados). Usamos o tamanho fixo do código (13 = GTIN, 14 = DUN) como
  // âncora pra separar certo em qualquer um dos dois formatos.

  function parseProdutoHeader(line) {
    const m = line.match(/^PRODUTO:\s*([^\s-][^-]*?)\s*-\s*(.+)$/i);
    if (!m) return null;
    return { codigo: m[1].trim(), descricao: m[2].trim() };
  }

  function parseLinhaBarcode(line) {
    const clean = line.trim();

    // DUN / caixa-fardo: sempre 14 dígitos fixos no início. A ordem das
    // colunas depois do código varia na extração do PDF (às vezes "NÃO"
    // vem antes do número de unidades, às vezes depois, às vezes colado
    // sem espaço) — em vez de depender de posição, pega o primeiro número
    // solto de 1-3 dígitos que sobrar no resto da linha, que nesse
    // relatório é sempre a coluna "Uni." (linha de DUN nunca tem peso/
    // medidas com casa decimal, só a NF/GTIN tem).
    const dunMatch = clean.match(/^(\d{14})/);
    if (dunMatch) {
      const barcode = dunMatch[1];
      const resto = clean.slice(barcode.length);
      const uniMatch = resto.match(/\b(\d{1,3})\b/);
      const uni = uniMatch ? parseInt(uniMatch[1], 10) : null;
      return { barcode, unidadesPorCaixa: uni || 1, ehCaixa: true };
    }

    // GTIN / unidade avulsa: exatamente 13 dígitos (não confundir com o
    // início de um DUN de 14 — por isso o DUN é checado primeiro acima).
    const gtinMatch = clean.match(/^(\d{13})(?!\d)/);
    if (gtinMatch) {
      return { barcode: gtinMatch[1], unidadesPorCaixa: 1, ehCaixa: false };
    }

    return null;
  }

  // Retorna um array de entradas { barcode, codigoProduto, descricao, unidadesPorCaixa, ehCaixa }
  function parseCatalogo(rawText) {
    const linhas = rawText.split(/\r?\n/);
    const entradas = [];
    let produtoAtual = null;

    for (const linhaBruta of linhas) {
      const linha = linhaBruta.trim();
      if (!linha) continue;

      const header = parseProdutoHeader(linha);
      if (header) {
        produtoAtual = header;
        continue;
      }

      if (!produtoAtual) continue;

      const barcodeInfo = parseLinhaBarcode(linha);
      if (barcodeInfo) {
        entradas.push({
          barcode: barcodeInfo.barcode,
          codigoProduto: produtoAtual.codigo,
          descricao: produtoAtual.descricao,
          unidadesPorCaixa: barcodeInfo.unidadesPorCaixa,
          ehCaixa: barcodeInfo.ehCaixa,
        });
      }
    }

    return entradas;
  }

  return { parseCatalogo };
})();
