import { describe, expect, it } from 'vitest';
import {
  PERMISSOES_VEDADAS_AO_ADMIN,
  validarMatrizDeAlcadas,
  validarParametro,
  validarPerfisDoUsuario,
  validarPermissoesDoPerfil,
  type FaixaEditavel,
} from './regras.js';

const CATALOGO = [
  'lote:aprovar',
  'lote:consultar',
  'recebimento:registrar',
  'nota_fiscal:lancar',
  'usuario:listar',
  'perfil:editar',
];

const codigos = <T extends { codigo: string }>(problemas: T[]) => problemas.map((p) => p.codigo);

describe('permissoes do perfil', () => {
  it('conjunto valido nao gera problema', () => {
    expect(validarPermissoesDoPerfil('Gerencia', ['lote:aprovar', 'lote:consultar'], CATALOGO)).toEqual([]);
  });

  it('perfil sem nenhuma permissao e recusado', () => {
    expect(codigos(validarPermissoesDoPerfil('Gerencia', [], CATALOGO))).toContain('SEM_PERMISSAO');
  });

  it('permissao fora do catalogo e recusada', () => {
    const p = validarPermissoesDoPerfil('Gerencia', ['lote:aprovar', 'lote:inventado'], CATALOGO);
    expect(codigos(p)).toContain('PERMISSAO_INEXISTENTE');
    expect(p[0]!.mensagem).toContain('lote:inventado');
  });

  it.each(PERMISSOES_VEDADAS_AO_ADMIN)('Administrador nao pode receber %s nem por edicao em tela', (vedada) => {
    const p = validarPermissoesDoPerfil('Administrador', ['usuario:listar', vedada], CATALOGO);
    expect(codigos(p)).toContain('VEDADA_AO_ADMIN');
  });

  it('a vedacao vale so para o Administrador', () => {
    expect(validarPermissoesDoPerfil('Gerencia', ['lote:aprovar'], CATALOGO)).toEqual([]);
  });

  it('Administrador com permissoes administrativas passa', () => {
    expect(validarPermissoesDoPerfil('Administrador', ['usuario:listar', 'perfil:editar'], CATALOGO)).toEqual([]);
  });
});

describe('perfis do usuario', () => {
  it('perfis compativeis passam', () => {
    expect(validarPerfisDoUsuario(['Gerencia'])).toEqual([]);
  });

  it('quem solicita nao cota: Solicitante + Comprador e bloqueado', () => {
    const p = validarPerfisDoUsuario(['Solicitante', 'Comprador']);
    expect(codigos(p)).toEqual(['CONFLITO_SOD']);
    expect(p[0]!.mensagem).toContain('Solicitante');
  });

  it('quem aprova nao recebe: Gerencia + Almoxarife e bloqueado', () => {
    expect(codigos(validarPerfisDoUsuario(['Gerencia', 'Almoxarife']))).toEqual(['CONFLITO_SOD']);
  });

  it('acumulo de tres perfis acusa cada conflito', () => {
    expect(validarPerfisDoUsuario(['Solicitante', 'Comprador', 'Almoxarife']).length).toBeGreaterThan(1);
  });
});

describe('matriz de alcadas', () => {
  const MATRIZ: FaixaEditavel[] = [
    { nivel: 1, valorMin: '0', valorMax: '1000', perfilAprovador: 'Comprador', propostasMinimas: 2, slaHoras: 0 },
    { nivel: 2, valorMin: '1000.01', valorMax: '5000', perfilAprovador: 'Coordenador', propostasMinimas: 3, slaHoras: 8 },
    { nivel: 3, valorMin: '5000.01', valorMax: null, perfilAprovador: 'Diretoria', propostasMinimas: 3, slaHoras: 48 },
  ];

  const com = (nivel: number, mudanca: Partial<FaixaEditavel>): FaixaEditavel[] =>
    MATRIZ.map((f) => (f.nivel === nivel ? { ...f, ...mudanca } : f));

  it('matriz continua e valida', () => {
    expect(validarMatrizDeAlcadas(MATRIZ)).toEqual([]);
  });

  it('matriz vazia e recusada', () => {
    expect(codigos(validarMatrizDeAlcadas([]))).toEqual(['SEM_FAIXA']);
  });

  it('ordem das faixas na entrada nao importa', () => {
    expect(validarMatrizDeAlcadas([...MATRIZ].reverse())).toEqual([]);
  });

  it('vao entre faixas deixa valor sem aprovador', () => {
    const p = validarMatrizDeAlcadas(com(2, { valorMin: '1000.05' }));
    expect(codigos(p)).toContain('VAO_ENTRE_FAIXAS');
    expect(p[0]!.mensagem).toContain('1000.01');
    expect(p[0]!.mensagem).toContain('1000.04');
  });

  it('sobreposicao faria o mesmo valor cair em duas faixas', () => {
    expect(codigos(validarMatrizDeAlcadas(com(2, { valorMin: '900' })))).toContain('SOBREPOSICAO');
  });

  it('primeira faixa precisa comecar do zero', () => {
    expect(codigos(validarMatrizDeAlcadas(com(1, { valorMin: '10' })))).toContain('NAO_COMECA_DO_ZERO');
  });

  it('ultima faixa precisa ser sem teto', () => {
    expect(codigos(validarMatrizDeAlcadas(com(3, { valorMax: '999999' })))).toContain('SEM_TETO_FINAL');
  });

  it('faixa do meio sem teto e recusada', () => {
    expect(codigos(validarMatrizDeAlcadas(com(2, { valorMax: null })))).toContain('TETO_NO_MEIO');
  });

  it('nivel duplicado e recusado', () => {
    const duplicada = [...MATRIZ, { ...MATRIZ[1]!, valorMin: '1000.01' }];
    expect(codigos(validarMatrizDeAlcadas(duplicada))).toContain('NIVEL_DUPLICADO');
  });

  it('teto menor que o piso e recusado', () => {
    expect(codigos(validarMatrizDeAlcadas(com(2, { valorMax: '500' })))).toContain('INTERVALO_INVERTIDO');
  });

  it('faixa sem proposta minima e recusada', () => {
    expect(codigos(validarMatrizDeAlcadas(com(2, { propostasMinimas: 0 })))).toContain('PROPOSTAS_INVALIDAS');
  });

  it('SLA negativo e recusado', () => {
    expect(codigos(validarMatrizDeAlcadas(com(2, { slaHoras: -1 })))).toContain('SLA_INVALIDO');
  });

  it('faixa unica sem teto e valida', () => {
    expect(
      validarMatrizDeAlcadas([
        { nivel: 1, valorMin: '0', valorMax: null, perfilAprovador: 'Diretoria', propostasMinimas: 3, slaHoras: 24 },
      ]),
    ).toEqual([]);
  });
});

describe('parametro', () => {
  it('mesmo tipo passa', () => {
    expect(validarParametro(0.015, 0.02)).toEqual([]);
    expect(validarParametro(['IN_APP'], ['IN_APP', 'EMAIL'])).toEqual([]);
    expect(validarParametro({ P1: 4 }, { P1: 6 })).toEqual([]);
  });

  it('trocar numero por texto e recusado', () => {
    const p = validarParametro(0.015, 'dois por cento');
    expect(codigos(p)).toEqual(['TIPO_DIFERENTE']);
    expect(p[0]!.mensagem).toContain('number');
  });

  it('lista nao vira objeto', () => {
    expect(codigos(validarParametro(['IN_APP'], { canal: 'IN_APP' }))).toEqual(['TIPO_DIFERENTE']);
  });

  it('valor ausente e recusado', () => {
    expect(codigos(validarParametro(0.015, null))).toEqual(['VALOR_INVALIDO']);
  });

  it('booleano continua booleano', () => {
    expect(validarParametro(true, false)).toEqual([]);
    expect(codigos(validarParametro(true, 'sim'))).toEqual(['TIPO_DIFERENTE']);
  });
});
