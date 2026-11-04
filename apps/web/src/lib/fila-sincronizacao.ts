import { api, ApiError } from './api';
import { listarLocal, removerLocal, salvarLocal, armazenamentoDisponivel } from './armazenamento-local';

/**
 * Fila de saida (outbox) do PWA. Toda operacao do checklist e enfileirada primeiro
 * e enviada depois - assim o motorista trabalha sem rede e o envio acontece quando volta.
 *
 * A ordem importa: abrir -> responder -> fotos -> finalizar. A fila e FIFO e para
 * na primeira falha permanente para nao enviar "finalizar" antes de "responder".
 */

export interface OperacaoNaFila {
  id: string;
  /** ordem de criacao; a fila e processada em ordem crescente */
  sequencia: number;
  caminho: string;
  metodo: 'POST' | 'PATCH';
  corpo: unknown;
  /** rotulo para a tela: "Foto do extintor", "Finalizar CHK-..." */
  descricao: string;
  criadoEm: string;
  tentativas: number;
  ultimoErro?: string | null;
}

let sequenciaAtual = Date.now();

export function novaOperacao(
  entrada: Omit<OperacaoNaFila, 'id' | 'sequencia' | 'criadoEm' | 'tentativas'>,
): OperacaoNaFila {
  sequenciaAtual += 1;
  return {
    ...entrada,
    id: crypto.randomUUID(),
    sequencia: sequenciaAtual,
    criadoEm: new Date().toISOString(),
    tentativas: 0,
  };
}

export async function enfileirar(operacao: OperacaoNaFila): Promise<void> {
  if (!armazenamentoDisponivel()) throw new Error('Armazenamento local indisponivel neste navegador.');
  await salvarLocal('fila', operacao);
}

export const lerFila = async (): Promise<OperacaoNaFila[]> =>
  armazenamentoDisponivel()
    ? (await listarLocal<OperacaoNaFila>('fila')).sort((a, b) => a.sequencia - b.sequencia)
    : [];

export interface ResultadoSincronizacao {
  enviadas: number;
  restantes: number;
  /** operacoes que a fila desistiu de enviar nesta rodada */
  descartadas: number;
  erro: string | null;
}

/**
 * Envia a fila em ordem.
 *
 * Erro permanente (4xx que nao seja 401/408/429) **sai da fila**, guardado em
 * `descartadas` com o motivo. Antes ele so era marcado e continuava ali: uma operacao
 * que nunca ia passar - "este checklist ja foi finalizado" - travava tudo que estava
 * atras dela, e o motorista ficava preso na tela com a fila crescendo.
 *
 * Falha de rede continua parando a fila sem descartar nada: a ordem importa, e enviar
 * "finalizar" antes de "responder" corromperia o checklist.
 */
export async function sincronizar(): Promise<ResultadoSincronizacao> {
  const fila = await lerFila();
  let enviadas = 0;
  let descartadas = 0;
  let primeiroErro: string | null = null;

  for (const operacao of fila) {
    try {
      await api(operacao.caminho, {
        method: operacao.metodo,
        body: JSON.stringify(operacao.corpo),
      });
      await removerLocal('fila', operacao.id);
      enviadas += 1;
    } catch (erro) {
      const permanente =
        erro instanceof ApiError && erro.status >= 400 && erro.status < 500 &&
        ![401, 408, 429].includes(erro.status);

      const motivo = erro instanceof ApiError ? erro.erro.mensagem : 'Sem conexao com o servidor.';

      if (permanente) {
        await salvarLocal('descartadas', {
          ...operacao,
          tentativas: operacao.tentativas + 1,
          ultimoErro: motivo,
          descartadaEm: new Date().toISOString(),
        });
        await removerLocal('fila', operacao.id);
        descartadas += 1;
        primeiroErro ??= `${operacao.descricao}: ${motivo}`;
        // segue para a proxima: esta nunca vai passar, e o resto nao tem culpa
        continue;
      }

      await salvarLocal('fila', {
        ...operacao,
        tentativas: operacao.tentativas + 1,
        ultimoErro: motivo,
      });

      // falha temporaria para a fila: enviar fora de ordem corromperia o checklist
      return {
        enviadas,
        descartadas,
        restantes: fila.length - enviadas - descartadas,
        erro: primeiroErro,
      };
    }
  }

  return { enviadas, descartadas, restantes: 0, erro: primeiroErro };
}

/** Operacoes que a fila desistiu de enviar, com o motivo. */
export const lerDescartadas = async (): Promise<Array<OperacaoNaFila & { descartadaEm: string }>> =>
  armazenamentoDisponivel()
    ? listarLocal<OperacaoNaFila & { descartadaEm: string }>('descartadas')
    : [];

export async function limparDescartadas(): Promise<void> {
  for (const o of await lerDescartadas()) await removerLocal('descartadas', o.id);
}

/** Sincroniza quando a conexao volta e ao abrir o app. */
export function observarConexao(aoSincronizar: (r: ResultadoSincronizacao) => void): () => void {
  const tentar = () => {
    if (navigator.onLine) void sincronizar().then(aoSincronizar);
  };

  window.addEventListener('online', tentar);
  const intervalo = window.setInterval(tentar, 30_000);
  tentar();

  return () => {
    window.removeEventListener('online', tentar);
    window.clearInterval(intervalo);
  };
}
