import { Decimal, dinheiro, type ValorMonetario } from '../../core/money.js';
import { conflitosEntre } from '../../core/rbac/sod.js';

/**
 * Regras de governanca (secoes 5.1 a 5.5). Modulo puro, sem I/O.
 *
 * Governanca e o unico lugar onde se muda quem pode o que, quanto cada faixa aprova e
 * como o sistema se comporta. Se essas regras nao morarem no servidor, quem editar a tela
 * edita a propria alcada - e a matriz vira decoracao.
 */

// ------------------------------------------------------------------ perfis e permissoes

/**
 * O Administrador administra, nao opera (secao 5.2). Estas permissoes nunca entram no
 * perfil dele, nem por edicao em tela: seria o mesmo usuario criando o proprio poder de
 * aprovar e depois usando.
 *
 * A lista cobre a **cadeia inteira** de compras e o recebimento, e nao so o ato de
 * aprovar. Quem edita perfis se concede o que quiser: barrar `lote:aprovar` e deixar
 * `cotacao:gerenciar` e `pedido:emitir` no mesmo perfil nao segrega nada — o administrador
 * cotaria, emitiria o pedido e so precisaria de um aprovador de fachada. E a mesma
 * combinacao que `CONFLITOS_DE_PERFIL` proibe entre Administrador e Comprador; proibi-la
 * entre perfis e permiti-la dentro de um deles seria matriz de enfeite (regra de ouro 5).
 */
export const PERMISSOES_VEDADAS_AO_ADMIN = [
  // opera compras
  'solicitacao:triar',
  'lote:criar',
  'lote:reatribuir',
  'lote:aprovar',
  'cotacao:gerenciar',
  'mapa:gerar',
  'pedido:emitir',
  // recebe material e mexe no estoque
  'recebimento:registrar',
  'nota_fiscal:lancar',
  'movimentacao:registrar',
  'inventario:gerenciar',
  // paga o que foi comprado
  'titulo:gerenciar',
] as const;

export const PERFIL_ADMINISTRADOR = 'Administrador';

export interface ProblemaDePerfil {
  codigo: 'PERMISSAO_INEXISTENTE' | 'VEDADA_AO_ADMIN' | 'SEM_PERMISSAO';
  mensagem: string;
}

/**
 * Valida o conjunto de permissoes que se quer gravar num perfil.
 * `catalogo` e o universo de permissoes existentes - permissao inventada nao entra.
 */
export function validarPermissoesDoPerfil(
  perfilNome: string,
  permissoes: string[],
  catalogo: string[],
): ProblemaDePerfil[] {
  const problemas: ProblemaDePerfil[] = [];
  const conhecidas = new Set(catalogo);

  if (permissoes.length === 0) {
    problemas.push({
      codigo: 'SEM_PERMISSAO',
      mensagem: 'Um perfil sem nenhuma permissao nao serve a ninguem. Inative-o em vez de esvazia-lo.',
    });
  }

  const desconhecidas = [...new Set(permissoes)].filter((p) => !conhecidas.has(p));
  if (desconhecidas.length > 0) {
    problemas.push({
      codigo: 'PERMISSAO_INEXISTENTE',
      mensagem: `Permissao inexistente: ${desconhecidas.join(', ')}.`,
    });
  }

  if (perfilNome === PERFIL_ADMINISTRADOR) {
    const vedadas = permissoes.filter((p) => (PERMISSOES_VEDADAS_AO_ADMIN as readonly string[]).includes(p));
    if (vedadas.length > 0) {
      problemas.push({
        codigo: 'VEDADA_AO_ADMIN',
        mensagem:
          `O Administrador nao opera compras: ${vedadas.join(', ')} nao pode entrar neste perfil. ` +
          'Quem administra o sistema nao aprova, nao recebe e nao lanca nota.',
      });
    }
  }

  return problemas;
}

/**
 * Perfis que nao podem coexistir no mesmo usuario (secao 5.3).
 * A matriz e a mesma exibida em tela - aqui ela vira bloqueio, nao aviso.
 */
export function validarPerfisDoUsuario(perfis: string[]): ProblemaDeUsuario[] {
  const conflitos = conflitosEntre(perfis);
  return conflitos.map((c) => ({
    codigo: 'CONFLITO_SOD' as const,
    mensagem: `${c.a} + ${c.b}: ${c.motivo}`,
  }));
}

export interface ProblemaDeUsuario {
  codigo: 'CONFLITO_SOD';
  mensagem: string;
}

// ------------------------------------------------------------------ matriz de alcadas

export interface FaixaEditavel {
  nivel: number;
  valorMin: ValorMonetario;
  /** null = sem teto; obrigatoriamente a ultima faixa */
  valorMax: ValorMonetario | null;
  perfilAprovador: string;
  propostasMinimas: number;
  slaHoras: number;
}

export interface ProblemaDeAlcada {
  codigo:
    | 'SEM_FAIXA'
    | 'NIVEL_DUPLICADO'
    | 'INTERVALO_INVERTIDO'
    | 'VAO_ENTRE_FAIXAS'
    | 'SOBREPOSICAO'
    | 'SEM_TETO_FINAL'
    | 'TETO_NO_MEIO'
    | 'NAO_COMECA_DO_ZERO'
    | 'PROPOSTAS_INVALIDAS'
    | 'SLA_INVALIDO';
  nivel?: number;
  mensagem: string;
}

/** Um centavo: a matriz e escrita em centavos (teto 1.000,00 / piso seguinte 1.000,01). */
const CENTAVO = new Decimal('0.01');

/**
 * Valida a matriz inteira, nao faixa a faixa.
 *
 * O que se protege aqui e o vao: se a faixa 2 termina em 5.000,00 e a 3 comeca em
 * 5.000,02, um lote de 5.000,01 nao tem aprovador - e `faixaPorValor` lanca em runtime,
 * no meio de uma submissao, para o comprador que nao tem nada com isso.
 */
export function validarMatrizDeAlcadas(faixas: FaixaEditavel[]): ProblemaDeAlcada[] {
  const problemas: ProblemaDeAlcada[] = [];

  if (faixas.length === 0) {
    return [{ codigo: 'SEM_FAIXA', mensagem: 'A matriz precisa de ao menos uma faixa de alcada.' }];
  }

  const ordenadas = [...faixas].sort((a, b) => a.nivel - b.nivel);

  const niveis = new Set<number>();
  for (const f of ordenadas) {
    if (niveis.has(f.nivel)) {
      problemas.push({ codigo: 'NIVEL_DUPLICADO', nivel: f.nivel, mensagem: `Nivel ${f.nivel} aparece duas vezes.` });
    }
    niveis.add(f.nivel);

    if (f.propostasMinimas < 1) {
      problemas.push({
        codigo: 'PROPOSTAS_INVALIDAS',
        nivel: f.nivel,
        mensagem: `Nivel ${f.nivel}: exija ao menos uma proposta.`,
      });
    }

    if (f.slaHoras < 0) {
      problemas.push({ codigo: 'SLA_INVALIDO', nivel: f.nivel, mensagem: `Nivel ${f.nivel}: SLA nao pode ser negativo.` });
    }

    if (f.valorMax !== null && dinheiro(f.valorMax).lessThan(dinheiro(f.valorMin))) {
      problemas.push({
        codigo: 'INTERVALO_INVERTIDO',
        nivel: f.nivel,
        mensagem: `Nivel ${f.nivel}: o teto e menor que o piso.`,
      });
    }
  }

  if (!dinheiro(ordenadas[0]!.valorMin).isZero()) {
    problemas.push({
      codigo: 'NAO_COMECA_DO_ZERO',
      nivel: ordenadas[0]!.nivel,
      mensagem: 'A primeira faixa precisa comecar em 0 — senao lote de valor baixo fica sem aprovador.',
    });
  }

  const ultima = ordenadas[ordenadas.length - 1]!;
  if (ultima.valorMax !== null) {
    problemas.push({
      codigo: 'SEM_TETO_FINAL',
      nivel: ultima.nivel,
      mensagem: 'A ultima faixa precisa ser sem teto — senao lote acima dela fica sem aprovador.',
    });
  }

  for (let i = 0; i < ordenadas.length - 1; i += 1) {
    const atual = ordenadas[i]!;
    const proxima = ordenadas[i + 1]!;

    if (atual.valorMax === null) {
      problemas.push({
        codigo: 'TETO_NO_MEIO',
        nivel: atual.nivel,
        mensagem: `Nivel ${atual.nivel} esta sem teto, mas nao e a ultima faixa.`,
      });
      continue;
    }

    const teto = dinheiro(atual.valorMax);
    const piso = dinheiro(proxima.valorMin);
    const esperado = teto.plus(CENTAVO);

    if (piso.lessThanOrEqualTo(teto)) {
      problemas.push({
        codigo: 'SOBREPOSICAO',
        nivel: proxima.nivel,
        mensagem: `Niveis ${atual.nivel} e ${proxima.nivel} se sobrepoem: o mesmo valor cairia em duas faixas.`,
      });
    } else if (!piso.equals(esperado)) {
      problemas.push({
        codigo: 'VAO_ENTRE_FAIXAS',
        nivel: proxima.nivel,
        mensagem:
          `Vao entre os niveis ${atual.nivel} e ${proxima.nivel}: valores entre ${esperado.toFixed(2)} e ` +
          `${piso.minus(CENTAVO).toFixed(2)} ficariam sem aprovador.`,
      });
    }
  }

  return problemas;
}

// ------------------------------------------------------------------ parametros

export interface ProblemaDeParametro {
  codigo: 'TIPO_DIFERENTE' | 'VALOR_INVALIDO';
  mensagem: string;
}

const tipoDe = (valor: unknown): string => (Array.isArray(valor) ? 'lista' : typeof valor);

/**
 * O parametro ja existe e tem um tipo; a edicao troca o valor, nao a natureza dele.
 * Gravar texto onde o codigo espera numero derruba o calculo la na frente, sem aviso.
 */
export function validarParametro(valorAtual: unknown, valorNovo: unknown): ProblemaDeParametro[] {
  const tipoAtual = tipoDe(valorAtual);
  const tipoNovo = tipoDe(valorNovo);

  if (valorNovo === null || valorNovo === undefined) {
    return [{ codigo: 'VALOR_INVALIDO', mensagem: 'Informe o valor do parametro.' }];
  }

  if (tipoAtual !== tipoNovo) {
    return [
      {
        codigo: 'TIPO_DIFERENTE',
        mensagem: `Este parametro e do tipo ${tipoAtual}; o valor informado e ${tipoNovo}.`,
      },
    ];
  }

  return [];
}
