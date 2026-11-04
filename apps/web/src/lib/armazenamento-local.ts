/**
 * IndexedDB minimo para o app do motorista (secao 7.3): o checklist de saida
 * precisa funcionar offline e sincronizar depois.
 *
 * Sem biblioteca: a superficie usada e pequena e uma dependencia a mais no
 * bundle do PWA custa mais do que estas 80 linhas.
 */

const BANCO = 'sgi-offline';
const VERSAO = 2;

/**
 * `descartadas` guarda o que a fila desistiu de enviar por erro permanente.
 * Sair da fila e obrigatorio - operacao que nunca vai passar trava tudo atras dela -,
 * mas sumir com o registro seria pior: fica aqui, com o motivo, para quem precisar ver.
 */
export type NomeDeposito = 'fila' | 'rascunhos' | 'descartadas';

let conexao: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  conexao ??= new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.open(BANCO, VERSAO);

    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('rascunhos')) db.createObjectStore('rascunhos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('descartadas')) db.createObjectStore('descartadas', { keyPath: 'id' });
    };

    /*
     * Aba antiga segurando a versao anterior bloqueia a atualizacao, e o app fica
     * esperando para sempre - sem erro, sem tela. Fechar a conexao ao receber
     * `versionchange` libera a atualizacao da outra aba em vez de trava-la.
     */
    pedido.onblocked = () =>
      rejeitar(new Error('Ha outra aba do sistema aberta com a versao anterior. Feche-a e recarregue.'));

    pedido.onsuccess = () => {
      pedido.result.onversionchange = () => {
        pedido.result.close();
        conexao = null;
      };
      resolver(pedido.result);
    };
    pedido.onerror = () => rejeitar(pedido.error ?? new Error('Nao foi possivel abrir o banco local.'));
  });

  return conexao;
}

async function transacao<T>(
  deposito: NomeDeposito,
  modo: IDBTransactionMode,
  acao: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await abrir();
  return new Promise((resolver, rejeitar) => {
    const tx = db.transaction(deposito, modo);
    const pedido = acao(tx.objectStore(deposito));
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rejeitar(pedido.error ?? new Error('Falha no banco local.'));
  });
}

export const salvarLocal = <T extends { id: string }>(deposito: NomeDeposito, valor: T): Promise<IDBValidKey> =>
  transacao(deposito, 'readwrite', (s) => s.put(valor));

export const lerLocal = <T>(deposito: NomeDeposito, id: string): Promise<T | undefined> =>
  transacao(deposito, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);

export const listarLocal = <T>(deposito: NomeDeposito): Promise<T[]> =>
  transacao(deposito, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);

export const removerLocal = (deposito: NomeDeposito, id: string): Promise<undefined> =>
  transacao(deposito, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>);

/** Disponivel em todo navegador que suporta PWA; a checagem evita quebrar em SSR ou teste. */
export const armazenamentoDisponivel = (): boolean =>
  typeof indexedDB !== 'undefined' && typeof window !== 'undefined';
