/**
 * Segregacao de funcoes (secao 5.3) - regras puras.
 * Regra de ouro 5: quem solicita nao cota; quem cota nao aprova; quem aprova nao recebe.
 *
 * Este modulo nao faz I/O e nao le configuracao, para poder ser testado sem banco.
 * A aplicacao com efeito (bloquear + auditar) fica em `sod.enforce.ts`.
 */

export type AcaoSod = 'COTAR' | 'APROVAR' | 'RECEBER' | 'AUTOAPROVAR';

/** Fotografia dos atores ja envolvidos no fluxo do lote/pedido em avaliacao. */
export interface ContextoSod {
  /** quem esta tentando executar a acao */
  usuarioId: string;
  acao: AcaoSod;
  /** autores das solicitacoes que compoem o lote */
  solicitantesIds?: string[];
  /** comprador responsavel pelo lote (quem cotou) */
  compradorId?: string | null;
  /** quem aprovou o lote */
  aprovadorId?: string | null;
  /** nivel de alcada exigido - faixa 1 admite autoaprovacao do comprador */
  nivelAlcada?: number | null;
  entidade: string;
  entidadeId: string;
}

export interface ResultadoSod {
  permitido: boolean;
  regra?: string;
  mensagem?: string;
  /** autoaprovacao de faixa 1: permitida, porem registrada como tal */
  marcarAutoaprovacao?: boolean;
}

const REGRAS = {
  SOLICITANTE_NAO_COTA: 'Quem abriu a solicitacao nao pode cota-la.',
  SOLICITANTE_NAO_APROVA: 'Quem abriu a solicitacao nao pode aprova-la.',
  COMPRADOR_NAO_APROVA: 'O comprador do lote nao pode aprovar o proprio lote.',
  APROVADOR_NAO_RECEBE: 'Quem aprovou o pedido nao pode registrar o recebimento.',
  COMPRADOR_NAO_RECEBE: 'Quem cotou o lote nao pode registrar o recebimento.',
} as const;

export type RegraSod = keyof typeof REGRAS;

/** Avaliacao pura - sem I/O. Testavel isoladamente. */
export function avaliarSod(ctx: ContextoSod): ResultadoSod {
  const ehSolicitante = (ctx.solicitantesIds ?? []).includes(ctx.usuarioId);
  const ehComprador = ctx.compradorId === ctx.usuarioId;
  const ehAprovador = ctx.aprovadorId === ctx.usuarioId;

  const negar = (regra: RegraSod): ResultadoSod => ({
    permitido: false,
    regra,
    mensagem: REGRAS[regra],
  });

  switch (ctx.acao) {
    case 'COTAR':
      if (ehSolicitante) return negar('SOLICITANTE_NAO_COTA');
      return { permitido: true };

    case 'APROVAR':
      if (ehSolicitante) return negar('SOLICITANTE_NAO_APROVA');
      if (ehComprador) {
        // Excecao unica: faixa 1 (autoaprovacao do comprador), sempre marcada no registro.
        if (ctx.nivelAlcada === 1) return { permitido: true, marcarAutoaprovacao: true };
        return negar('COMPRADOR_NAO_APROVA');
      }
      return { permitido: true };

    case 'AUTOAPROVAR':
      if (ctx.nivelAlcada !== 1) return negar('COMPRADOR_NAO_APROVA');
      if (ehSolicitante) return negar('SOLICITANTE_NAO_APROVA');
      return { permitido: true, marcarAutoaprovacao: true };

    case 'RECEBER':
      if (ehAprovador) return negar('APROVADOR_NAO_RECEBE');
      if (ehComprador) return negar('COMPRADOR_NAO_RECEBE');
      return { permitido: true };

    default:
      return { permitido: true };
  }
}

/**
 * Matriz de conflitos exibida na tela de administracao (secao 5.3):
 * perfis que nao devem coexistir no mesmo usuario.
 */
export const CONFLITOS_DE_PERFIL: ReadonlyArray<{ a: string; b: string; motivo: string }> = [
  { a: 'Solicitante', b: 'Comprador', motivo: 'Quem solicita nao cota.' },
  { a: 'Comprador', b: 'Coordenador de Suprimentos', motivo: 'Cotar e aprovar na mesma pessoa anula a alcada.' },
  { a: 'Comprador', b: 'Almoxarife', motivo: 'Quem cota nao recebe.' },
  { a: 'Gerencia', b: 'Almoxarife', motivo: 'Quem aprova nao recebe.' },
  { a: 'Diretoria', b: 'Almoxarife', motivo: 'Quem aprova nao recebe.' },
  { a: 'Administrador', b: 'Comprador', motivo: 'Administrador nao opera compras.' },
  { a: 'Administrador', b: 'Almoxarife', motivo: 'Administrador nao recebe material.' },
  { a: 'Auditor', b: 'Comprador', motivo: 'Auditor e somente leitura.' },
];

export function conflitosEntre(perfis: string[]): Array<{ a: string; b: string; motivo: string }> {
  return CONFLITOS_DE_PERFIL.filter((c) => perfis.includes(c.a) && perfis.includes(c.b));
}
