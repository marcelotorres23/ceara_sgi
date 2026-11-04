import { describe, expect, it } from 'vitest';
import { alertaDeHodometro, deveAvancarCadastro, hodometroConsolidado } from './hodometro.js';

const leitura = (registrado: string | null, informado: string | null) =>
  alertaDeHodometro({ registrado, informado, origem: 'checklist', placa: 'PTM1J88' });

describe('alertaDeHodometro', () => {
  it('alerta quando a leitura e menor que a registrada no cadastro', () => {
    const a = leitura('120500', '119000');
    expect(a?.tipo).toBe('HODOMETRO_RETROCEDEU');
    expect(a?.diferenca).toBe('1500.0');
    expect(a?.mensagem).toContain('PTM1J88');
  });

  it('nao alerta quando a leitura avanca dentro do esperado', () => {
    expect(leitura('120500', '120800')).toBeNull();
  });

  it('nao alerta quando a leitura repete o valor registrado', () => {
    expect(leitura('120500', '120500')).toBeNull();
  });

  it('alerta no salto grande, que costuma ser digito a mais', () => {
    const a = leitura('120500', '1205000');
    expect(a?.tipo).toBe('HODOMETRO_SALTOU');
  });

  it('respeita o limite de salto informado', () => {
    expect(alertaDeHodometro({ registrado: '1000', informado: '7000', origem: 'checklist', saltoMaximoKm: 10000 })).toBeNull();
  });

  it('primeira leitura do veiculo nao alerta: nao ha o que comparar', () => {
    expect(leitura(null, '80000')).toBeNull();
    expect(leitura('0', '80000')).toBeNull();
  });

  it('sem leitura informada nao ha alerta', () => {
    expect(leitura('120500', null)).toBeNull();
  });

  it('diz de onde veio a leitura, porque a pessoa precisa reconhecer o que fez', () => {
    const a = alertaDeHodometro({ registrado: '500', informado: '100', origem: 'saida na portaria' });
    expect(a?.mensagem).toContain('saida na portaria');
  });
});

describe('hodometroConsolidado', () => {
  it('leitura menor nao baixa a quilometragem do cadastro', () => {
    expect(hodometroConsolidado('120500', '119000')?.toString()).toBe('120500');
  });

  it('leitura maior avanca o cadastro', () => {
    expect(hodometroConsolidado('120500', '120800')?.toString()).toBe('120800');
  });

  it('sem leitura nao mexe no cadastro', () => {
    expect(hodometroConsolidado('120500', null)).toBeNull();
  });
});

describe('deveAvancarCadastro', () => {
  it('so grava quando a leitura avanca', () => {
    expect(deveAvancarCadastro('120500', '120800')).toBe(true);
    expect(deveAvancarCadastro('120500', '120500')).toBe(false);
    expect(deveAvancarCadastro('120500', '119000')).toBe(false);
    expect(deveAvancarCadastro(null, '119000')).toBe(true);
  });
});
