// Leitura de código de barras ao vivo pela câmera, usando a API nativa
// BarcodeDetector do navegador (sem precisar baixar nenhuma biblioteca).
const BarcodeScanner = (() => {
  const FORMATOS = ["ean_13", "ean_8", "itf", "code_128", "upc_a"];
  const DEBOUNCE_MS = 1800; // evita ler o mesmo código várias vezes seguidas

  let stream = null;
  let detector = null;
  let timerId = null;
  let ultimoCodigo = null;
  let ultimoTempo = 0;

  function suportado() {
    return typeof window.BarcodeDetector !== "undefined";
  }

  function criarDetector() {
    try {
      return new BarcodeDetector({ formats: FORMATOS });
    } catch (e) {
      // Navegador não suporta algum formato da lista — tenta só o mais comum.
      return new BarcodeDetector({ formats: ["ean_13"] });
    }
  }

  async function iniciar(videoEl, onDetect, onError) {
    if (!suportado()) {
      onError && onError(new Error("Este navegador não suporta leitura de código de barras pela câmera."));
      return;
    }
    try {
      detector = criarDetector();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      agendarLeitura(videoEl, onDetect);
    } catch (e) {
      onError && onError(e);
    }
  }

  function agendarLeitura(videoEl, onDetect) {
    timerId = setTimeout(async () => {
      if (!stream) return;
      try {
        const codigos = await detector.detect(videoEl);
        if (codigos.length) {
          const valor = codigos[0].rawValue;
          const agora = Date.now();
          if (valor !== ultimoCodigo || agora - ultimoTempo > DEBOUNCE_MS) {
            ultimoCodigo = valor;
            ultimoTempo = agora;
            onDetect(valor);
          }
        }
      } catch (e) {
        // erro de leitura de um frame isolado (foco, movimento) — ignora e continua
      }
      agendarLeitura(videoEl, onDetect);
    }, 300);
  }

  function parar() {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    ultimoCodigo = null;
    ultimoTempo = 0;
  }

  return { suportado, iniciar, parar };
})();
