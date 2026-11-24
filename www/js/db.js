/* Banco local (IndexedDB). Tudo fica no aparelho; nada vai para a internet. */
(function (root) {
  'use strict';
  const NOME = 'inventario-florestal', VERSAO = 2;
  let dbp = null;
  function abrir() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NOME, VERSAO);
      r.onupgradeneeded = () => {
        // cria só o que falta: quem já tem a versão 1 ganha a tabela de fotos sem perder nada
        const db = r.result, tem = n => db.objectStoreNames.contains(n);
        if (!tem('projetos')) db.createObjectStore('projetos', { keyPath: 'id' });
        if (!tem('parcelas')) db.createObjectStore('parcelas', { keyPath: 'id' }).createIndex('projetoId', 'projetoId');
        if (!tem('pontos')) db.createObjectStore('pontos', { keyPath: 'id' }).createIndex('projetoId', 'projetoId');
        if (!tem('config')) db.createObjectStore('config', { keyPath: 'chave' });
        if (!tem('fotos')) db.createObjectStore('fotos', { keyPath: 'id' }).createIndex('projetoId', 'projetoId');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, modo, fn) {
    const db = await abrir();
    return new Promise((res, rej) => {
      const t = db.transaction(store, modo), s = t.objectStore(store);
      let out; const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  const DB = {
    todos: store => tx(store, 'readonly', s => s.getAll()),
    pegar: (store, id) => tx(store, 'readonly', s => s.get(id)),
    salvar: (store, obj) => { obj.atualizado = Date.now(); return tx(store, 'readwrite', s => s.put(obj)); },
    salvarCru: (store, obj) => tx(store, 'readwrite', s => s.put(obj)),
    apagar: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
    porProjeto: (store, pid) => tx(store, 'readonly', s => s.index('projetoId').getAll(pid)),
    async config(chave, valor) {
      if (valor === undefined) { const r = await tx('config', 'readonly', s => s.get(chave)); return r ? r.valor : undefined; }
      return tx('config', 'readwrite', s => s.put({ chave, valor }));
    }
  };
  root.DB = DB;
})(window);
