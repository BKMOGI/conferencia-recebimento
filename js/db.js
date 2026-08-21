// Armazenamento local (IndexedDB) das sessões de conferência e do catálogo
// de código de barras (GTIN/DUN).
const Db = (() => {
  const DB_NAME = "conferencia_recebimento";
  const DB_VERSION = 2;
  const STORE = "sessions";
  const STORE_CATALOGO = "catalogo";

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_CATALOGO)) {
          const cat = db.createObjectStore(STORE_CATALOGO, { keyPath: "barcode" });
          cat.createIndex("codigoProduto", "codigoProduto", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // Substitui o catálogo inteiro pelas entradas novas (reimportar zera o anterior).
  async function saveCatalogo(entradas) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CATALOGO, "readwrite");
      const store = tx.objectStore(STORE_CATALOGO);
      store.clear();
      for (const entrada of entradas) store.put(entrada);
      tx.oncomplete = () => resolve(entradas.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getCatalogoPorBarcode(barcode) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CATALOGO, "readonly");
      const req = tx.objectStore(STORE_CATALOGO).get(barcode);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function contarCatalogo() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CATALOGO, "readonly");
      const req = tx.objectStore(STORE_CATALOGO).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveSession(session) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(session);
      tx.oncomplete = () => resolve(session);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getSession(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function listSessions() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteSession(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    saveSession, getSession, listSessions, deleteSession,
    saveCatalogo, getCatalogoPorBarcode, contarCatalogo,
  };
})();
