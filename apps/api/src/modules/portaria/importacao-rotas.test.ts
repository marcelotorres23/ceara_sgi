import { describe, expect, it } from 'vitest';
import { codigoDaRota, inteiro, nomeLimpo, traduzirLinhaDeRota } from './importacao-rotas.js';

describe('codigoDaRota', () => {
  it('tira acento e pontuacao para o codigo nao depender de como digitaram', () => {
    expect(codigoDaRota('SÃO J. CARÚ')).toBe('SAO-J-CARU');
    expect(codigoDaRota('COROATÁ 1')).toBe('COROATA-1');
    expect(codigoDaRota('APICUM-AÇÚ')).toBe('APICUM-ACU');
  });

  it('ignora espaco sobrando: reimportar a mesma rota corrige, nao duplica', () => {
    expect(codigoDaRota('LAGO DA PEDRA  ')).toBe(codigoDaRota('lago da pedra'));
  });

  it('mantem rotas homonimas numeradas separadas', () => {
    expect(codigoDaRota('MIRANDA 1')).not.toBe(codigoDaRota('MIRANDA 2'));
  });
});

describe('traduzirLinhaDeRota', () => {
  it('le a linha da planilha comercial', () => {
    expect(traduzirLinhaDeRota(['SÃO LUIS ', '8', '5', 'SEGUNDA A SEXTA', 'TERÇA A SABADO'])).toEqual({
      nome: 'SÃO LUIS',
      vendedores: 8,
      diasPreVenda: 5,
      fechamento: 'SEGUNDA A SEXTA',
      largada: 'TERÇA A SABADO',
    });
  });

  it('linha sem nome nao e rota', () => {
    expect(traduzirLinhaDeRota(['   ', '2', '6'])).toBeNull();
  });

  it('celula vazia vira null, e nao zero', () => {
    expect(traduzirLinhaDeRota(['BREJO', '', ''])).toMatchObject({ vendedores: null, diasPreVenda: null });
  });
});

describe('utilitarios da planilha', () => {
  it('nomeLimpo colapsa espaco duplo', () => expect(nomeLimpo('GOV.  NUNES  FREIRE 1 ')).toBe('GOV. NUNES FREIRE 1'));
  it('inteiro ignora texto', () => expect(inteiro('2 vendedores')).toBe(2));
  it('inteiro devolve null quando nao ha numero', () => expect(inteiro('-')).toBeNull());
});
