import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '../../core/errors/index.js';
import {
  arrastoNoBoard,
  DESTINOS_COM_ATO_PROPRIO,
  PERMISSAO_POR_DESTINO,
  ehRetrocesso,
  ESTADOS_FINAIS,
  exigeMotivo,
  podeEncerrar,
  podeTransicionar,
  transicoesValidas,
  validarTransicao,
  type StatusLote,
} from './state-machine.js';

describe('fluxo principal', () => {
  const caminho: StatusLote[] = [
    'RASCUNHO', 'TRIAGEM', 'EM_COTACAO', 'MAPA_PRONTO', 'AGUARDANDO_APROVACAO', 'APROVADO',
    'PEDIDO_EMITIDO', 'AGUARDANDO_ENTREGA', 'RECEBIDO', 'NF_LANCADA', 'ENCERRADO',
  ];

  it('percorre o ciclo completo sem transicao invalida', () => {
    for (let i = 0; i < caminho.length - 1; i += 1) {
      expect(podeTransicionar(caminho[i]!, caminho[i + 1]!)).toBe(true);
    }
  });

  it('nao permite pular etapas', () => {
    expect(podeTransicionar('TRIAGEM', 'APROVADO')).toBe(false);
    expect(podeTransicionar('EM_COTACAO', 'PEDIDO_EMITIDO')).toBe(false);
    expect(podeTransicionar('RASCUNHO', 'ENCERRADO')).toBe(false);
  });

  it('transicao invalida lanca 422, nunca passa silenciosa', () => {
    expect(() => validarTransicao('TRIAGEM', 'APROVADO')).toThrow(InvalidTransitionError);
    try {
      validarTransicao('TRIAGEM', 'APROVADO');
    } catch (e) {
      expect((e as InvalidTransitionError).statusCode).toBe(422);
    }
  });

  it('nao permite transicao para o mesmo estado', () => {
    expect(() => validarTransicao('EM_COTACAO', 'EM_COTACAO')).toThrow(InvalidTransitionError);
  });
});

describe('estados finais', () => {
  it('ENCERRADO e CANCELADO nao tem saida', () => {
    expect(transicoesValidas('ENCERRADO')).toHaveLength(0);
    expect(transicoesValidas('CANCELADO')).toHaveLength(0);
    expect([...ESTADOS_FINAIS].sort()).toEqual(['CANCELADO', 'ENCERRADO']);
  });

  it('lote encerrado nao volta para nenhum estado', () => {
    expect(() => validarTransicao('ENCERRADO', 'RECEBIDO', 'tentativa')).toThrow(InvalidTransitionError);
  });
});

describe('motivo obrigatorio', () => {
  it.each<[StatusLote, StatusLote]>([
    ['TRIAGEM', 'DEVOLVIDO_AO_SOLICITANTE'],
    ['AGUARDANDO_APROVACAO', 'REPROVADO'],
    ['AGUARDANDO_APROVACAO', 'EM_RENEGOCIACAO'],
    ['EM_COTACAO', 'CANCELADO'],
  ])('%s -> %s exige motivo', (de, para) => {
    expect(exigeMotivo(de, para)).toBe(true);
    expect(() => validarTransicao(de, para)).toThrow(InvalidTransitionError);
    expect(validarTransicao(de, para, 'especificacao incompleta').motivo).toBe('especificacao incompleta');
  });

  it('motivo em branco ou curto demais nao vale', () => {
    expect(() => validarTransicao('TRIAGEM', 'CANCELADO', '   ')).toThrow(InvalidTransitionError);
    expect(() => validarTransicao('TRIAGEM', 'CANCELADO', 'abc')).toThrow(InvalidTransitionError);
  });

  it('avanco normal nao exige motivo', () => {
    expect(exigeMotivo('TRIAGEM', 'EM_COTACAO')).toBe(false);
    expect(validarTransicao('TRIAGEM', 'EM_COTACAO').motivo).toBeNull();
  });
});

describe('retrocesso no fluxo', () => {
  it('voltar do mapa para a cotacao e retrocesso e exige motivo', () => {
    expect(ehRetrocesso('MAPA_PRONTO', 'EM_COTACAO')).toBe(true);
    expect(() => validarTransicao('MAPA_PRONTO', 'EM_COTACAO')).toThrow(InvalidTransitionError);
    expect(validarTransicao('MAPA_PRONTO', 'EM_COTACAO', 'fornecedor revisou o preco').motivo).toBeTruthy();
  });

  it('avancar nao e retrocesso', () => {
    expect(ehRetrocesso('EM_COTACAO', 'MAPA_PRONTO')).toBe(false);
  });

  it('estados laterais ficam fora da ordem do fluxo', () => {
    expect(ehRetrocesso('TRIAGEM', 'CANCELADO')).toBe(false);
  });
});

describe('caminhos de excecao', () => {
  it('devolvido ao solicitante volta para triagem', () => {
    expect(podeTransicionar('DEVOLVIDO_AO_SOLICITANTE', 'TRIAGEM')).toBe(true);
  });

  it('reprovado pode ir para renegociacao', () => {
    expect(podeTransicionar('REPROVADO', 'EM_RENEGOCIACAO')).toBe(true);
  });

  it('bloqueio por divergencia nao pode ser encerrado direto', () => {
    expect(podeTransicionar('BLOQUEADO_DIVERGENCIA', 'ENCERRADO')).toBe(false);
  });
});

describe('regra de encerramento', () => {
  const base = { status: 'NF_LANCADA' as StatusLote, materialRecebido: true, notaFiscalLancada: true, tituloProvisionado: true };

  it('encerra com material recebido, NF lancada e titulo provisionado', () => {
    expect(podeEncerrar(base)).toBe(true);
  });

  it.each([
    ['sem material recebido', { materialRecebido: false }],
    ['sem NF lancada', { notaFiscalLancada: false }],
    ['sem titulo provisionado', { tituloProvisionado: false }],
    ['fora do estado NF_LANCADA', { status: 'RECEBIDO' as StatusLote }],
  ])('nao encerra %s', (_, alteracao) => {
    expect(podeEncerrar({ ...base, ...alteracao })).toBe(false);
  });
});

describe('arrasto no board', () => {
  it('aprovar nao se faz arrastando o card', () => {
    /*
     * A regressao que este teste guarda: `POST /painel/mover` exigia apenas `lote:consultar`
     * e chamava a maquina de estados direto. O comprador arrastava o card para "Aprovado" e
     * pulava, de uma vez, a permissao `lote:aprovar`, a faixa de alcada e a SoD que impede
     * quem cotou de aprovar o proprio lote.
     */
    const d = arrastoNoBoard('APROVADO');
    expect(d.permitido).toBe(false);
    if (!d.permitido) expect(d.motivo).toMatch(/alcada/i);
  });

  it.each<StatusLote>(['APROVADO', 'REPROVADO', 'PEDIDO_EMITIDO', 'RECEBIDO', 'RECEBIDO_PARCIAL', 'NF_LANCADA', 'ENCERRADO'])(
    '%s tem ato proprio e e recusado no arrasto',
    (destino) => {
      expect(arrastoNoBoard(destino).permitido).toBe(false);
    },
  );

  it('recusa aponta a tela certa, em vez de so barrar', () => {
    for (const destino of Object.keys(DESTINOS_COM_ATO_PROPRIO) as StatusLote[]) {
      const d = arrastoNoBoard(destino);
      expect(d.permitido).toBe(false);
      // mensagem que so diz "nao pode" obriga a pessoa a adivinhar o caminho
      if (!d.permitido) expect(d.motivo.length).toBeGreaterThan(40);
    }
  });

  it.each([
    ['EM_COTACAO', 'cotacao:gerenciar'],
    ['MAPA_PRONTO', 'mapa:gerar'],
    ['AGUARDANDO_APROVACAO', 'mapa:gerar'],
    ['EM_RENEGOCIACAO', 'lote:aprovar'],
    ['CANCELADO', 'solicitacao:cancelar'],
    ['TRIAGEM', 'solicitacao:triar'],
  ] as Array<[StatusLote, string]>)('mover para %s cobra %s', (destino, permissao) => {
    const d = arrastoNoBoard(destino);
    expect(d.permitido).toBe(true);
    if (d.permitido) expect(d.exige).toBe(permissao);
  });

  it('nenhum destino do arrasto se contenta com lote:consultar', () => {
    // `lote:consultar` abre o board; nao pode mover nada nele
    for (const destino of Object.values(PERMISSAO_POR_DESTINO)) {
      expect(destino).not.toBe('lote:consultar');
    }
  });

  it('destino sem dono explicito entra fechado', () => {
    // estado novo na maquina de estados nao pode virar atalho por esquecimento
    const semDono = arrastoNoBoard('RASCUNHO');
    expect(semDono.permitido).toBe(false);
  });

  it('todo destino alcancavel esta classificado: ou tem ato proprio, ou tem permissao', () => {
    const TODOS: StatusLote[] = [
      'RASCUNHO', 'TRIAGEM', 'EM_COTACAO', 'MAPA_PRONTO', 'AGUARDANDO_APROVACAO', 'APROVADO',
      'PEDIDO_EMITIDO', 'AGUARDANDO_ENTREGA', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'NF_LANCADA',
      'ENCERRADO', 'DEVOLVIDO_AO_SOLICITANTE', 'EM_RENEGOCIACAO', 'REPROVADO', 'CANCELADO',
      'BLOQUEADO_DIVERGENCIA',
    ];
    const alcancaveis = new Set<StatusLote>();
    for (const de of TODOS) for (const para of transicoesValidas(de)) alcancaveis.add(para);
    const semClassificacao = [...alcancaveis].filter(
      (s) => !DESTINOS_COM_ATO_PROPRIO[s] && !PERMISSAO_POR_DESTINO[s],
    );
    expect(semClassificacao).toEqual([]);
  });
});
