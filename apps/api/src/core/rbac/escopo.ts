import type { AccessClaims } from '../auth/tokens.js';
import { ForbiddenError, ValidationError } from '../errors/index.js';

/**
 * Escopo de dados por unidade (secao 5.6).
 *
 * A operacao e multiunidade: o usuario declara no login qual unidade esta operacionalizando
 * e tudo que ele ve e grava fica preso a ela. Quem tem `unidade:todas` - Comprador e
 * Administrador no seed - enxerga a rede inteira e pode filtrar unidade a unidade.
 *
 * Modulo puro: recebe as claims, devolve decisao. Quem consulta o banco e o servico.
 */

export const PERMISSAO_TODAS_UNIDADES = 'unidade:todas';

export interface EscopoUnidade {
  /** true quando o usuario opera a rede inteira */
  todas: boolean;
  /** unidades que o usuario pode operar; vazia quando `todas` */
  permitidas: string[];
  /** unidade declarada como em operacao agora - destino padrao de tudo que ele grava */
  ativa: string | null;
}

export function escopoDe(claims: AccessClaims): EscopoUnidade {
  return {
    todas: claims.permissoes.includes(PERMISSAO_TODAS_UNIDADES),
    permitidas: claims.unidades ?? [],
    ativa: claims.unidadeAtivaId ?? null,
  };
}

/** Pode este usuario tocar em dado desta unidade? */
export function podeAcessarUnidade(claims: AccessClaims, unidadeId: string): boolean {
  const escopo = escopoDe(claims);
  return escopo.todas || escopo.permitidas.includes(unidadeId);
}

/** Barra o acesso cruzado entre unidades. A UI esconde; aqui a porta fecha. */
export function assegurarUnidade(claims: AccessClaims, unidadeId: string): void {
  if (!podeAcessarUnidade(claims, unidadeId)) {
    throw new ForbiddenError('Seu acesso nao alcanca esta unidade.');
  }
}

/**
 * Unidade de destino de um registro novo. Sem unidade ativa nao ha gravacao:
 * dado orfao de unidade contamina todo relatorio depois.
 */
export function unidadeDeEscrita(claims: AccessClaims, informada?: string | null): string {
  const alvo = informada ?? escopoDe(claims).ativa;
  if (!alvo) {
    throw new ValidationError('Informe a unidade em operacao para prosseguir.');
  }
  assegurarUnidade(claims, alvo);
  return alvo;
}

/**
 * Fragmento `where` de unidade para toda listagem e todo relatorio.
 *
 * - quem ve tudo: sem filtro, ou exatamente a unidade pedida no parametro;
 * - os demais: sempre a unidade ativa, e pedir outra e 403.
 */
export interface FiltroUnidade {
  unidadeId?: string | { in: string[] };
}

export function filtroUnidade(claims: AccessClaims, unidadeIdPedida?: string | null): FiltroUnidade {
  const escopo = escopoDe(claims);

  if (unidadeIdPedida) {
    assegurarUnidade(claims, unidadeIdPedida);
    return { unidadeId: unidadeIdPedida };
  }

  if (escopo.todas) return {};

  if (escopo.ativa) return { unidadeId: escopo.ativa };

  // sem unidade ativa e sem alcance global: nada e visivel, e melhor que tudo ser visivel
  return { unidadeId: { in: escopo.permitidas } };
}

/**
 * Mesmo filtro para tabelas que herdam a unidade de um relacionamento
 * (abastecimento, checklist, saldo) - `caminho` e o nome da relacao no Prisma.
 */
export function filtroUnidadeEm(
  claims: AccessClaims,
  caminho: string,
  unidadeIdPedida?: string | null,
): Record<string, unknown> {
  const filtro = filtroUnidade(claims, unidadeIdPedida);
  if (Object.keys(filtro).length === 0) return {};
  return { [caminho]: filtro };
}

/** Unidades efetivamente consultadas - vai no cabecalho do relatorio, junto da memoria de calculo. */
export function unidadesConsultadas(
  claims: AccessClaims,
  unidadeIdPedida?: string | null,
): string[] | 'TODAS' {
  const escopo = escopoDe(claims);
  if (unidadeIdPedida) {
    assegurarUnidade(claims, unidadeIdPedida);
    return [unidadeIdPedida];
  }
  if (escopo.todas) return 'TODAS';
  return escopo.ativa ? [escopo.ativa] : escopo.permitidas;
}
