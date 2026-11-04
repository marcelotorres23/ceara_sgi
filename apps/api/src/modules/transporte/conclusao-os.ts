/**
 * Fechamento da ordem de servico (secao 7.5). Modulo puro, sem I/O.
 *
 * O mecanico trabalha com a folha impressa na bancada e anota nela o que descobriu: peca
 * que faltou, servico que ficou para depois, o que de fato foi feito. No fechamento essas
 * anotacoes entram no sistema — senao a OS registra so o que foi previsto, e a diferenca
 * entre o previsto e o executado se perde exatamente onde ela importa.
 */

export type TipoConclusao = 'TOTAL' | 'PARCIAL';

export interface ProblemaDeConclusao {
  codigo:
    | 'SEM_PENDENCIA_NA_PARCIAL'
    | 'PENDENCIA_NA_TOTAL'
    | 'SEM_MECANICO'
    | 'FECHAMENTO_ANTES_DA_ABERTURA'
    | 'SEM_ITEM';
  mensagem: string;
}

export interface DadosDaConclusao {
  tipo: TipoConclusao;
  /** o que o mecanico escreveu na folha; livre, e o relato do que foi feito */
  anotacoes?: string | null;
  /** quem executou: pode ser da casa ou da oficina de terceiro, por isso e texto */
  mecanico?: string | null;
  /** obrigatorio na parcial: o que ficou faltando */
  pendencia?: string | null;
  abertaEm: Date;
  fechadaEm: Date;
  /** OS sem nenhum item registrado quase sempre e OS que ninguem lancou */
  quantidadeDeItens: number;
}

/**
 * Valida o fechamento. Lista vazia = pode concluir.
 *
 * A parcial exige dizer o que ficou faltando. "Concluida parcialmente" sem a pendencia
 * escrita e a mesma coisa que concluida — e o que sobrou volta como surpresa na proxima
 * quebra, sem ninguem lembrar que ja se sabia.
 */
export function validarConclusao(dados: DadosDaConclusao): ProblemaDeConclusao[] {
  const problemas: ProblemaDeConclusao[] = [];
  const pendencia = dados.pendencia?.trim() ?? '';

  if (dados.fechadaEm < dados.abertaEm) {
    problemas.push({
      codigo: 'FECHAMENTO_ANTES_DA_ABERTURA',
      mensagem: 'A data de fechamento nao pode ser anterior a abertura da OS.',
    });
  }

  if (dados.tipo === 'PARCIAL' && pendencia.length < 5) {
    problemas.push({
      codigo: 'SEM_PENDENCIA_NA_PARCIAL',
      mensagem: 'Conclusao parcial exige descrever o que ficou pendente.',
    });
  }

  if (dados.tipo === 'TOTAL' && pendencia.length > 0) {
    problemas.push({
      codigo: 'PENDENCIA_NA_TOTAL',
      mensagem: 'Ha pendencia descrita, entao a conclusao e parcial, nao total.',
    });
  }

  if ((dados.mecanico?.trim().length ?? 0) < 3) {
    problemas.push({
      codigo: 'SEM_MECANICO',
      mensagem: 'Informe quem executou o servico.',
    });
  }

  if (dados.quantidadeDeItens === 0) {
    problemas.push({
      codigo: 'SEM_ITEM',
      mensagem:
        'Esta OS nao tem nenhuma peca ou servico lancado. Lance o que foi feito antes de concluir — ' +
        'OS sem item nao alimenta custo por veiculo.',
    });
  }

  return problemas;
}

export const podeConcluir = (dados: DadosDaConclusao): boolean => validarConclusao(dados).length === 0;

/**
 * A parcial deixa trabalho para tras, e trabalho para tras precisa de uma OS que o carregue.
 * Sem isso, a pendencia vira uma frase num campo de texto que ninguem mais consulta.
 */
export function descricaoDaOsDeRetorno(numeroOriginal: string, pendencia: string): string {
  return `Pendencia da ${numeroOriginal}: ${pendencia.trim()}`;
}
