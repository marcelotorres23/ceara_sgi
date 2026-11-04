import { describe, expect, it } from 'vitest';
import {
  descricaoDaOsDeRetorno,
  podeConcluir,
  validarConclusao,
  type DadosDaConclusao,
} from './conclusao-os.js';

const ABERTA = new Date('2026-08-10T08:00:00Z');
const FECHADA = new Date('2026-08-10T15:30:00Z');

const conclusao = (over: Partial<DadosDaConclusao> = {}): DadosDaConclusao => ({
  tipo: 'TOTAL',
  anotacoes: 'Trocado o filtro de oleo e a correia do alternador.',
  mecanico: 'Raimundo Souza',
  pendencia: null,
  abertaEm: ABERTA,
  fechadaEm: FECHADA,
  quantidadeDeItens: 2,
  ...over,
});

const codigos = (dados: DadosDaConclusao) => validarConclusao(dados).map((p) => p.codigo);

describe('conclusao total', () => {
  it('fechamento completo passa', () => {
    expect(validarConclusao(conclusao())).toEqual([]);
    expect(podeConcluir(conclusao())).toBe(true);
  });

  it('total com pendencia descrita e contradicao', () => {
    const p = validarConclusao(conclusao({ pendencia: 'falta trocar a bomba' }));
    expect(p.map((x) => x.codigo)).toContain('PENDENCIA_NA_TOTAL');
    expect(p[0]!.mensagem).toContain('parcial');
  });

  it('anotacao do mecanico e opcional: nem todo servico rende relato', () => {
    expect(validarConclusao(conclusao({ anotacoes: null }))).toEqual([]);
  });
});

describe('conclusao parcial', () => {
  it('parcial com pendencia descrita passa', () => {
    expect(validarConclusao(conclusao({ tipo: 'PARCIAL', pendencia: 'falta a bomba, sem estoque' }))).toEqual([]);
  });

  it('parcial sem pendencia e recusada', () => {
    expect(codigos(conclusao({ tipo: 'PARCIAL', pendencia: null }))).toContain('SEM_PENDENCIA_NA_PARCIAL');
  });

  it('pendencia vazia ou curta demais nao vale', () => {
    expect(codigos(conclusao({ tipo: 'PARCIAL', pendencia: '   ' }))).toContain('SEM_PENDENCIA_NA_PARCIAL');
    expect(codigos(conclusao({ tipo: 'PARCIAL', pendencia: 'nao' }))).toContain('SEM_PENDENCIA_NA_PARCIAL');
  });
});

describe('quem executou', () => {
  it('sem mecanico e recusada', () => {
    expect(codigos(conclusao({ mecanico: null }))).toContain('SEM_MECANICO');
  });

  it('nome curto demais nao identifica ninguem', () => {
    expect(codigos(conclusao({ mecanico: 'Jo' }))).toContain('SEM_MECANICO');
  });

  it('mecanico de oficina terceira tambem serve, por ser texto livre', () => {
    expect(validarConclusao(conclusao({ mecanico: 'Oficina Sao Jorge - Pedro' }))).toEqual([]);
  });
});

describe('coerencia do fechamento', () => {
  it('fechar antes de abrir e recusado', () => {
    expect(
      codigos(conclusao({ fechadaEm: new Date('2026-08-09T10:00:00Z') })),
    ).toContain('FECHAMENTO_ANTES_DA_ABERTURA');
  });

  it('fechar no mesmo instante da abertura e aceito', () => {
    expect(codigos(conclusao({ fechadaEm: ABERTA }))).not.toContain('FECHAMENTO_ANTES_DA_ABERTURA');
  });

  it('OS sem nenhum item lancado nao conclui', () => {
    const p = validarConclusao(conclusao({ quantidadeDeItens: 0 }));
    expect(p.map((x) => x.codigo)).toContain('SEM_ITEM');
    expect(p[0]!.mensagem).toContain('custo por veiculo');
  });

  it('acumula os problemas em vez de parar no primeiro', () => {
    const p = codigos(conclusao({ tipo: 'PARCIAL', pendencia: null, mecanico: null, quantidadeDeItens: 0 }));
    expect(p).toEqual(['SEM_PENDENCIA_NA_PARCIAL', 'SEM_MECANICO', 'SEM_ITEM']);
  });
});

describe('OS de retorno', () => {
  it('carrega o numero da original e a pendencia', () => {
    expect(descricaoDaOsDeRetorno('OS-2026-0042', '  falta a bomba, sem estoque  ')).toBe(
      'Pendencia da OS-2026-0042: falta a bomba, sem estoque',
    );
  });
});
