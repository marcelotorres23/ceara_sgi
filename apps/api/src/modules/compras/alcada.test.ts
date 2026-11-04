import { describe, expect, it } from 'vitest';
import { aprovadorHabilitado, checarPropostasMinimas, decidirAlcada, faixaPorValor, somarItens, type FaixaAlcada } from './alcada.js';

/** Matriz do seed (secao 6.4). */
const FAIXAS: FaixaAlcada[] = [
  { nivel: 1, valorMin: '0', valorMax: '1000', perfilAprovador: 'Comprador', propostasMinimas: 2, slaHoras: 0 },
  { nivel: 2, valorMin: '1000.01', valorMax: '5000', perfilAprovador: 'Coordenador de Suprimentos', propostasMinimas: 3, slaHoras: 8 },
  { nivel: 3, valorMin: '5000.01', valorMax: '20000', perfilAprovador: 'Gerencia', propostasMinimas: 3, slaHoras: 24 },
  { nivel: 4, valorMin: '20000.01', valorMax: null, perfilAprovador: 'Diretoria', propostasMinimas: 3, slaHoras: 48 },
];

describe('enquadramento por valor', () => {
  it.each([
    ['0', 1],
    ['999.99', 1],
    ['1000', 1],
    ['1000.01', 2],
    ['5000', 2],
    ['5000.01', 3],
    ['20000', 3],
    ['20000.01', 4],
    ['1500000', 4],
  ])('valor %s cai na faixa %i', (valor, nivel) => {
    expect(faixaPorValor(FAIXAS, valor).nivel).toBe(nivel);
  });

  it('recusa valor negativo', () => {
    expect(() => faixaPorValor(FAIXAS, '-1')).toThrow(RangeError);
  });

  it('o vao entre o teto de uma faixa e o piso da seguinte nao deixa valor descoberto', () => {
    // 1000.005 esta entre o teto da faixa 1 (1000.00) e o piso da faixa 2 (1000.01).
    // Arredondado para centavos vira 1000.01 e cai na faixa 2, em vez de nao ter faixa.
    expect(faixaPorValor(FAIXAS, '1000.005').nivel).toBe(2);
    expect(faixaPorValor(FAIXAS, '1000.004').nivel).toBe(1);
  });
});

describe('decisao de alcada', () => {
  it('faixa 1 permite autoaprovacao do comprador', () => {
    const d = decidirAlcada(FAIXAS, '800');
    expect(d.nivel).toBe(1);
    expect(d.autoaprovacaoPermitida).toBe(true);
    expect(d.perfilAprovador).toBe('Comprador');
  });

  it('faixa 2 exige Coordenador e 3 propostas', () => {
    const d = decidirAlcada(FAIXAS, '4000');
    expect([d.nivel, d.perfilAprovador, d.propostasMinimas, d.slaHoras]).toEqual([2, 'Coordenador de Suprimentos', 3, 8]);
    expect(d.autoaprovacaoPermitida).toBe(false);
  });

  it('escolha divergente sobe exatamente um nivel', () => {
    const d = decidirAlcada(FAIXAS, '4000', { escolhaDivergente: true });
    expect(d.nivelOriginal).toBe(2);
    expect(d.nivel).toBe(3);
    expect(d.perfilAprovador).toBe('Gerencia');
    expect(d.elevadoPorDivergencia).toBe(true);
  });

  it('divergencia na faixa 1 tira a autoaprovacao do comprador', () => {
    const d = decidirAlcada(FAIXAS, '800', { escolhaDivergente: true });
    expect(d.nivel).toBe(2);
    expect(d.autoaprovacaoPermitida).toBe(false);
  });

  it('divergencia no topo da matriz permanece no ultimo nivel', () => {
    const d = decidirAlcada(FAIXAS, '90000', { escolhaDivergente: true });
    expect(d.nivel).toBe(4);
    expect(d.elevadoPorDivergencia).toBe(false);
  });

  it('respeita a ordem dos niveis mesmo com faixas desordenadas', () => {
    const embaralhadas = [FAIXAS[3]!, FAIXAS[0]!, FAIXAS[2]!, FAIXAS[1]!];
    expect(decidirAlcada(embaralhadas, '4000', { escolhaDivergente: true }).nivel).toBe(3);
  });
});

describe('propostas minimas', () => {
  it('bloqueia abaixo do minimo e diz quantas faltam', () => {
    const c = checarPropostasMinimas(decidirAlcada(FAIXAS, '4000'), 1);
    expect(c.suficiente).toBe(false);
    expect(c.mensagem).toContain('Registre mais 2');
  });

  it('libera no minimo exato', () => {
    expect(checarPropostasMinimas(decidirAlcada(FAIXAS, '4000'), 3).suficiente).toBe(true);
  });

  it('faixa 1 exige apenas 2 propostas', () => {
    expect(checarPropostasMinimas(decidirAlcada(FAIXAS, '500'), 2).suficiente).toBe(true);
  });
});

describe('total do lote', () => {
  it('soma quantidade x preco unitario sem erro de ponto flutuante', () => {
    // 0.1 * 3 + 0.2 = 0.5 exato; em float daria 0.5000000000000001
    expect(somarItens([{ quantidade: '3', precoUnitario: '0.1' }, { quantidade: '1', precoUnitario: '0.2' }]).toFixed(2)).toBe('0.50');
  });

  it('soma quantidades fracionarias', () => {
    expect(somarItens([{ quantidade: '2.5', precoUnitario: '19.90' }]).toFixed(2)).toBe('49.75');
  });
});

describe('quem aprova cada faixa', () => {
  const nivelDe = (valor: string) => faixaPorValor(FAIXAS, valor).nivel;

  it('a Gerencia nao aprova o lote de R$ 51.000 que a matriz manda para a Diretoria', () => {
    /*
     * O caso real que motivou a regra: LOTE-2026-0050, R$ 51.000, faixa 4. `lote:aprovar`
     * dizia que a Gerencia aprova alguma coisa; nada conferia o quanto.
     */
    const h = aprovadorHabilitado(FAIXAS, nivelDe('51000'), ['Gerencia']);
    expect(h.pode).toBe(false);
    expect(h.perfilExigido).toBe('Diretoria');
    expect(h.nivelMaximo).toBe(3);
    expect(h.motivo).toContain('faixa 4');
    expect(h.motivo).toContain('Diretoria');
  });

  it('a Diretoria aprova o mesmo lote', () => {
    expect(aprovadorHabilitado(FAIXAS, nivelDe('51000'), ['Diretoria']).pode).toBe(true);
  });

  it('faixa maior alcanca faixa menor: quem aprova sem teto aprova o que esta abaixo', () => {
    for (const valor of ['500', '3000', '10000', '51000']) {
      expect(aprovadorHabilitado(FAIXAS, nivelDe(valor), ['Diretoria']).pode, valor).toBe(true);
    }
  });

  it('faixa menor nao alcanca faixa maior — e o teto que a matriz existe para impor', () => {
    expect(aprovadorHabilitado(FAIXAS, nivelDe('3000'), ['Coordenador de Suprimentos']).pode).toBe(true);
    expect(aprovadorHabilitado(FAIXAS, nivelDe('10000'), ['Coordenador de Suprimentos']).pode).toBe(false);
  });

  it('acumulo de perfis vale pelo maior', () => {
    const h = aprovadorHabilitado(FAIXAS, nivelDe('51000'), ['Gerencia', 'Diretoria']);
    expect(h.pode).toBe(true);
    expect(h.nivelMaximo).toBe(4);
  });

  it('quem nao aprova nenhuma faixa recebe o motivo, e nao um nao seco', () => {
    const h = aprovadorHabilitado(FAIXAS, nivelDe('3000'), ['Almoxarife']);
    expect(h.pode).toBe(false);
    expect(h.nivelMaximo).toBeNull();
    expect(h.motivo).toContain('Coordenador de Suprimentos');
  });

  it('faixa que sumiu da matriz nao vira aprovacao livre', () => {
    // alcada desativada em tela nao pode transformar lote pendente em "aprova qualquer um"
    const h = aprovadorHabilitado(FAIXAS, 9, ['Diretoria']);
    expect(h.pode).toBe(false);
    expect(h.motivo).toContain('nao existe mais');
  });

  it('lote sem faixa apurada tambem nao passa', () => {
    expect(aprovadorHabilitado(FAIXAS, 0, ['Diretoria']).pode).toBe(false);
  });
});
