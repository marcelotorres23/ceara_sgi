import { describe, expect, it } from 'vitest';
import { dataPrevista, diasAteVencer, diasSemLeitura, ritmoPorDia, type LeituraDeUso } from './ritmo-de-uso.js';

const hoje = new Date('2026-08-19T12:00:00Z');
const diasAtras = (n: number) => new Date(hoje.getTime() - n * 86_400_000);

const leitura = (valor: number, dias: number, manual = false): LeituraDeUso => ({
  valor: String(valor),
  medidoEm: diasAtras(dias),
  manual,
});

describe('ritmoPorDia', () => {
  it('apura o km/dia do periodo', () => {
    // 100.000 -> 101.400 em 20 dias: 70 km/dia
    const r = ritmoPorDia([leitura(100_000, 20), leitura(101_400, 0)], 30, hoje);
    expect(r?.toString()).toBe('70');
  });

  it('com pesos iguais, e a taxa simples do periodo inteiro', () => {
    const r = ritmoPorDia([leitura(100_000, 30), leitura(101_000, 20), leitura(103_000, 0)], 31, hoje);
    // 3.000 km em 30 dias
    expect(r?.toString()).toBe('100');
  });

  it('uma leitura so nao prova ritmo nenhum', () => {
    expect(ritmoPorDia([leitura(100_000, 5)], 30, hoje)).toBeNull();
  });

  it('sem leitura na janela, nao ha ritmo', () => {
    expect(ritmoPorDia([leitura(100_000, 90), leitura(105_000, 60)], 30, hoje)).toBeNull();
  });

  it('caminhao parado no periodo nao tem ritmo a declarar', () => {
    expect(ritmoPorDia([leitura(100_000, 20), leitura(100_000, 0)], 30, hoje)).toBeNull();
  });

  it('medidor que voltou nao entra na conta', () => {
    // a leitura invertida no meio e ignorada; o trecho seguinte conta normal
    const r = ritmoPorDia([leitura(100_000, 20), leitura(50_000, 10), leitura(51_000, 0)], 30, hoje);
    expect(r?.toString()).toBe('100');
  });

  it('leitura manual pesa menos que a da automacao', () => {
    const soAutomatica = ritmoPorDia([leitura(100_000, 20), leitura(101_000, 10), leitura(102_000, 0)], 30, hoje);
    // mesmo avanco, mas o trecho recente veio manual e com o dobro de rodagem
    const comManual = ritmoPorDia([leitura(100_000, 20), leitura(101_000, 10), leitura(103_000, 0, true)], 30, hoje);

    expect(soAutomatica?.toString()).toBe('100');
    // o trecho manual puxa a media para cima, mas menos do que puxaria com peso cheio
    const semPeso = (1_000 + 2_000) / 20;
    expect(Number(comManual)).toBeGreaterThan(100);
    expect(Number(comManual)).toBeLessThan(semPeso);
  });

  it('trecho impossivel e descartado: nao existe caminhao a 240.000 km/dia', () => {
    // o caso real da frota: cadastro em 71.102 km e planilha de trocas em 155.442
    const r = ritmoPorDia([leitura(71_102, 8), leitura(155_442, 7), leitura(155_512, 0)], 30, hoje);
    expect(Number(r)).toBeLessThan(100);
  });

  it('o teto de ritmo e ajustavel para operacao de longa distancia', () => {
    const r = ritmoPorDia([leitura(100_000, 2), leitura(104_000, 0)], 30, hoje, 3_000);
    expect(r?.toString()).toBe('2000');
  });

  it('duas leituras na mesma manha nao viram ritmo de 400 km/dia', () => {
    const r = ritmoPorDia(
      [
        { valor: '100000', medidoEm: new Date('2026-08-19T07:00:00Z') },
        { valor: '100050', medidoEm: new Date('2026-08-19T09:00:00Z') },
      ],
      30,
      hoje,
    );
    // o piso de meio dia segura a extrapolacao: 50 km em 2h nao vira 600 km/dia
    expect(Number(r)).toBeLessThanOrEqual(100);
  });
});

describe('diasAteVencer', () => {
  it('converte o que falta em dias de operacao', () => {
    expect(diasAteVencer('1200', '70')).toBe(17);
  });

  it('item ja vencido nao tem o que prever', () => {
    expect(diasAteVencer('0', '70')).toBe(0);
  });

  it('sem ritmo apurado, nao ha previsao', () => {
    expect(diasAteVencer('1200', null)).toBeNull();
  });

  it('ritmo zero nao vira divisao por zero', () => {
    expect(diasAteVencer('1200', '0')).toBeNull();
  });
});

describe('dataPrevista', () => {
  it('projeta a data da entrada na oficina', () => {
    expect(dataPrevista(6, hoje)?.toISOString().slice(0, 10)).toBe('2026-08-25');
  });

  it('sem dias previstos, nao ha data', () => {
    expect(dataPrevista(null, hoje)).toBeNull();
  });
});

describe('diasSemLeitura', () => {
  it('conta ha quanto tempo o ativo nao da sinal', () => {
    expect(diasSemLeitura(diasAtras(12), hoje)).toBe(12);
  });

  it('ativo sem nenhuma leitura devolve null, e nao zero', () => {
    expect(diasSemLeitura(null, hoje)).toBeNull();
  });
});
