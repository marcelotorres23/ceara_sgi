import { describe, expect, it } from 'vitest';
import { agruparPor, totaisDoRelatorio, type LinhaDeAbastecimento } from './relatorio-abastecimento.js';

const linha = (over: Partial<LinhaDeAbastecimento> = {}): LinhaDeAbastecimento => ({
  litros: '100',
  valorTotal: '600.00',
  kmPercorridos: '300',
  veiculo: 'PTM1J88',
  motorista: 'Joao',
  posto: 'Posto interno',
  combustivel: 'S10',
  ...over,
});

describe('totaisDoRelatorio', () => {
  it('soma litros, dinheiro e km do periodo', () => {
    const t = totaisDoRelatorio([linha(), linha({ litros: '50', valorTotal: '300.00', kmPercorridos: '150' })]);
    expect(t.abastecimentos).toBe(2);
    expect(t.litros).toBe('150.000');
    expect(t.valorTotal).toBe('900.00');
    expect(t.kmPercorridos).toBe('450.0');
  });

  it('consumo do periodo e km total sobre litros totais, e nao media de medias', () => {
    // 300 km / 100 L = 3,0 km/L · 150 km / 50 L = 3,0 km/L — aqui os dois dao o mesmo
    const iguais = totaisDoRelatorio([linha(), linha({ litros: '50', valorTotal: '300.00', kmPercorridos: '150' })]);
    expect(iguais.consumoMedioKml).toBe('3.000');

    /*
     * Agora com rendimentos diferentes e volumes muito diferentes: 30 L rendendo 10 km/L e
     * 300 L rendendo 2 km/L. A media das medias daria 6; o consumo real do periodo e
     * (300 + 600) / 330 = 2,727.
     */
    const diferentes = totaisDoRelatorio([
      linha({ litros: '30', valorTotal: '180.00', kmPercorridos: '300' }),
      linha({ litros: '300', valorTotal: '1800.00', kmPercorridos: '600' }),
    ]);
    expect(diferentes.consumoMedioKml).toBe('2.727');
  });

  it('registro sem km apurado entra no gasto, mas fica fora do consumo', () => {
    const t = totaisDoRelatorio([
      linha({ litros: '100', valorTotal: '600.00', kmPercorridos: '300' }),
      linha({ litros: '80', valorTotal: '480.00', kmPercorridos: null }),
    ]);

    expect(t.litros).toBe('180.000');
    expect(t.valorTotal).toBe('1080.00');
    expect(t.semKmApurado).toBe(1);
    // o consumo usa so os 100 L que tem distancia conhecida
    expect(t.consumoMedioKml).toBe('3.000');
  });

  it('custo por km sai do dinheiro que tem distancia, e nao do total gasto', () => {
    const t = totaisDoRelatorio([
      linha({ litros: '100', valorTotal: '600.00', kmPercorridos: '300' }),
      linha({ litros: '80', valorTotal: '480.00', kmPercorridos: null }),
    ]);
    expect(t.custoPorKm).toBe('2.0000');
  });

  it('preco medio por litro considera tudo que foi comprado', () => {
    const t = totaisDoRelatorio([linha({ litros: '100', valorTotal: '600.00' })]);
    expect(t.precoMedioPorLitro).toBe('6.0000');
  });

  it('periodo sem nenhum km conhecido nao inventa consumo', () => {
    const t = totaisDoRelatorio([linha({ kmPercorridos: null })]);
    expect(t.consumoMedioKml).toBeNull();
    expect(t.custoPorKm).toBeNull();
  });

  it('conta as anomalias do periodo', () => {
    const t = totaisDoRelatorio([linha({ anomalia: true }), linha(), linha({ anomalia: true })]);
    expect(t.anomalias).toBe(2);
  });

  it('relatorio vazio devolve zeros, e nao erro', () => {
    const t = totaisDoRelatorio([]);
    expect(t.abastecimentos).toBe(0);
    expect(t.litros).toBe('0.000');
    expect(t.consumoMedioKml).toBeNull();
  });
});

describe('agruparPor', () => {
  const linhas = [
    linha({ veiculo: 'PTM1J88', valorTotal: '600.00' }),
    linha({ veiculo: 'PTM1J88', valorTotal: '400.00' }),
    linha({ veiculo: 'ROO2C65', valorTotal: '1500.00' }),
  ];

  it('agrupa e ordena por quanto cada um gastou', () => {
    const grupos = agruparPor(linhas, 'veiculo');
    expect(grupos.map((g) => g.chave)).toEqual(['ROO2C65', 'PTM1J88']);
    expect(grupos[1]?.valorTotal).toBe('1000.00');
    expect(grupos[1]?.abastecimentos).toBe(2);
  });

  it('cada grupo traz os mesmos totais do relatorio inteiro', () => {
    const grupos = agruparPor(linhas, 'veiculo');
    expect(grupos[0]?.consumoMedioKml).toBe('3.000');
  });

  it('chave vazia vira "nao informado" em vez de sumir da conta', () => {
    const grupos = agruparPor([linha({ motorista: null })], 'motorista');
    expect(grupos[0]?.chave).toBe('nao informado');
  });
});
