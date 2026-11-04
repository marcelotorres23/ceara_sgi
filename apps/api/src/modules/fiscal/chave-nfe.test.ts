import { describe, expect, it } from 'vitest';
import {
  chaveValida,
  digitoVerificador,
  emitenteConfere,
  formatarCnpj,
  lerChaveNfe,
  normalizarChave,
  ChaveNfeInvalida,
} from './chave-nfe.js';

/** Monta uma chave valida: 43 digitos informados + DV calculado. */
const comDv = (base43: string): string => `${base43}${digitoVerificador(base43)}`;

// MA (21) · 2026-08 · CNPJ 12345678000199 · modelo 55 · serie 001 · numero 000001234
// tipo de emissao 1 · codigo numerico 00000001 = 43 digitos, antes do DV
const BASE = '21' + '2608' + '12345678000199' + '55' + '001' + '000001234' + '1' + '00000001';
const CHAVE = comDv(BASE);

describe('digito verificador mod-11', () => {
  it('calcula o DV a partir dos 43 primeiros digitos', () => {
    expect(digitoVerificador(BASE)).toBe(Number(CHAVE[43]));
  });

  it('resto 0 ou 1 vira DV zero, conforme o manual da NF-e', () => {
    // varre bases ate achar uma que caia no caso de borda, e confirma o zero
    const zeros = Array.from({ length: 40 }, (_, i) => BASE.slice(0, 42) + String(i % 10))
      .map((base) => digitoVerificador(base))
      .filter((dv) => dv === 0);
    expect(zeros.length).toBeGreaterThan(0);
  });

  it('recusa entrada que nao tem 43 digitos', () => {
    expect(() => digitoVerificador('123')).toThrow(ChaveNfeInvalida);
  });
});

describe('leitura da chave', () => {
  it('destrincha UF, competencia, CNPJ, modelo, serie e numero', () => {
    const lida = lerChaveNfe(CHAVE);
    expect(lida.ufSigla).toBe('MA');
    expect(lida.competencia).toBe('2026-08');
    expect(lida.cnpjEmitente).toBe('12345678000199');
    expect(lida.modelo).toBe('55');
    expect(lida.serie).toBe('001');
    expect(lida.numero).toBe('000001234');
  });

  it('aceita chave copiada com pontuacao e espaco', () => {
    const suja = CHAVE.replace(/(\d{4})/g, '$1 ').trim();
    expect(lerChaveNfe(suja).chave).toBe(CHAVE);
    expect(normalizarChave('2126.0812 3456')).toBe('212608123456');
  });

  it('recusa digito verificador trocado, dizendo qual era o esperado', () => {
    const errada = `${BASE}${(Number(CHAVE[43]) + 1) % 10}`;
    expect(() => lerChaveNfe(errada)).toThrow(/deveria terminar em/);
  });

  it('recusa tamanho errado dizendo quantos digitos vieram', () => {
    expect(() => lerChaveNfe('123')).toThrow(/tem 3/);
  });

  it('recusa UF inexistente', () => {
    expect(() => lerChaveNfe(comDv(`99${BASE.slice(2)}`))).toThrow(/nao correspondem a uma UF/);
  });

  it('recusa mes de emissao impossivel', () => {
    const base = `2126${'13'}${BASE.slice(6)}`;
    expect(() => lerChaveNfe(comDv(base))).toThrow(/mes de emissao/i);
  });

  it('recusa modelo que nao e NF-e nem NFC-e', () => {
    const base = `${BASE.slice(0, 20)}57${BASE.slice(22)}`;
    expect(() => lerChaveNfe(comDv(base))).toThrow(/nao e NF-e/);
  });

  it('aceita NFC-e, modelo 65', () => {
    const base = `${BASE.slice(0, 20)}65${BASE.slice(22)}`;
    expect(lerChaveNfe(comDv(base)).modelo).toBe('65');
  });
});

describe('validacao sem excecao', () => {
  it('devolve os dados quando a chave e valida', () => {
    const r = chaveValida(CHAVE);
    expect(r.valida).toBe(true);
    expect(r.dados?.ufSigla).toBe('MA');
  });

  it('devolve o motivo quando nao e', () => {
    const r = chaveValida('123');
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/44 digitos/);
  });
});

describe('confronto com o fornecedor do pedido', () => {
  it('confere o CNPJ do emitente embutido na chave', () => {
    const lida = lerChaveNfe(CHAVE);
    expect(emitenteConfere(lida, '12.345.678/0001-99')).toBe(true);
    expect(emitenteConfere(lida, '99.999.999/0001-99')).toBe(false);
  });

  it('formata o CNPJ para exibicao', () => {
    expect(formatarCnpj('12345678000199')).toBe('12.345.678/0001-99');
  });
});
