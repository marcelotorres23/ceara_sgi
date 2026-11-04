import { describe, expect, it } from 'vitest';
import {
  conferir,
  dataBr,
  detectarSeparador,
  exigir,
  exigirData,
  exigirNumero,
  exigirPlaca,
  lerCsv,
  normalizarCabecalho,
  numeroBr,
  placa,
  ErroDeConversao,
} from './csv.js';

const ARQUIVO = [
  'Data;Placa;Litros;Valor Total;Hodômetro',
  '03/08/2026 14:30;ABC-1234;120,500;1.234,56;312450',
  '04/08/2026;ABC1D23;80,000;812,00;98000',
].join('\r\n');

describe('leitura do arquivo', () => {
  it('detecta o separador ponto-e-virgula do Excel pt-BR', () => {
    expect(detectarSeparador('a;b;c')).toBe(';');
    expect(detectarSeparador('a,b,c')).toBe(',');
    expect(detectarSeparador('a\tb\tc')).toBe('\t');
  });

  it('normaliza cabecalho com acento e espaco', () => {
    expect(normalizarCabecalho('Valor Total')).toBe('valor_total');
    expect(normalizarCabecalho('Hodômetro')).toBe('hodometro');
    expect(normalizarCabecalho('  Nº do Cartão ')).toBe('n_do_cartao');
  });

  it('le linhas com CRLF e ignora linha vazia no fim', () => {
    const arquivo = lerCsv(`${ARQUIVO}\r\n\r\n`);
    expect(arquivo.linhas).toHaveLength(2);
    expect(arquivo.cabecalhos).toEqual(['data', 'placa', 'litros', 'valor_total', 'hodometro']);
  });

  it('come o BOM que o Excel escreve', () => {
    const arquivo = lerCsv(`﻿Data;Placa\n03/08/2026;ABC-1234`);
    expect(arquivo.cabecalhos[0]).toBe('data');
  });

  it('numera a linha como o operador ve no Excel', () => {
    const arquivo = lerCsv(ARQUIVO);
    expect(arquivo.linhas[0]?.numero).toBe(2);
  });

  it('respeita aspas com o separador dentro do campo', () => {
    const arquivo = lerCsv('posto;obs\nSede;"Rua A, 100; fundos"');
    expect(arquivo.linhas[0]?.valores.obs).toBe('Rua A, 100; fundos');
  });

  it('entende aspas duplicadas como aspa literal', () => {
    const arquivo = lerCsv('obs\n"disse ""ok"" ao motorista"');
    expect(arquivo.linhas[0]?.valores.obs).toBe('disse "ok" ao motorista');
  });

  it('arquivo vazio nao quebra', () => {
    expect(lerCsv('').linhas).toEqual([]);
  });
});

describe('conversores brasileiros', () => {
  it('converte numero com virgula decimal e ponto de milhar', () => {
    expect(numeroBr('1.234,56')).toBe('1234.56');
    expect(numeroBr('120,500')).toBe('120.500');
    expect(numeroBr('80')).toBe('80');
  });

  it('aceita tambem o formato com ponto decimal', () => {
    expect(numeroBr('1234.56')).toBe('1234.56');
  });

  it('devolve null para o que nao e numero', () => {
    expect(numeroBr('abc')).toBeNull();
    expect(numeroBr('')).toBeNull();
    expect(numeroBr(undefined)).toBeNull();
  });

  it('converte data brasileira com e sem hora', () => {
    expect(dataBr('03/08/2026')?.toISOString()).toBe('2026-08-03T03:00:00.000Z');
    expect(dataBr('03/08/2026 14:30')?.toISOString()).toBe('2026-08-03T17:30:00.000Z');
  });

  it('aceita ISO e recusa o resto', () => {
    expect(dataBr('2026-08-03T12:00:00Z')?.toISOString()).toBe('2026-08-03T12:00:00.000Z');
    expect(dataBr('32/13/2026')).toBeNull();
    expect(dataBr('ontem')).toBeNull();
  });

  it('aceita placa nos dois padroes', () => {
    expect(placa('abc-1234')).toBe('ABC1234');
    expect(placa('ABC1D23')).toBe('ABC1D23');
    expect(placa('A1')).toBeNull();
  });
});

describe('conferencia linha a linha', () => {
  const converter = (linha: Parameters<typeof exigir>[0]) => ({
    data: exigirData(linha, 'data'),
    placa: exigirPlaca(linha, 'placa'),
    litros: exigirNumero(linha, 'litros'),
    valorTotal: exigirNumero(linha, 'valor_total'),
  });

  it('converte as linhas validas', () => {
    const r = conferir(lerCsv(ARQUIVO), ['data', 'placa', 'litros'], converter);
    expect(r.erros).toEqual([]);
    expect(r.validas).toHaveLength(2);
    expect(r.validas[0]?.dados.litros).toBe('120.500');
  });

  it('recusa o arquivo inteiro quando falta coluna obrigatoria, dizendo o que veio', () => {
    const r = conferir(lerCsv('data;placa\n03/08/2026;ABC-1234'), ['data', 'placa', 'litros'], converter);
    expect(r.validas).toEqual([]);
    expect(r.erros[0]?.mensagem).toMatch(/nao tem a\(s\) coluna\(s\): litros/);
    expect(r.erros[0]?.mensagem).toMatch(/Colunas encontradas: data, placa/);
  });

  it('acumula os erros em vez de parar na primeira linha ruim', () => {
    const arquivo = lerCsv(
      [
        'data;placa;litros;valor_total',
        '03/08/2026;ABC-1234;120,5;100,00',
        'ontem;ABC-1234;10;10',
        '05/08/2026;XX;10;10',
        '06/08/2026;ABC-1234;dez;10',
      ].join('\n'),
    );

    const r = conferir(arquivo, ['data', 'placa', 'litros'], converter);
    expect(r.validas).toHaveLength(1);
    expect(r.erros).toHaveLength(3);
    expect(r.erros.map((e) => e.linha)).toEqual([3, 4, 5]);
  });

  it('a mensagem de erro nomeia a coluna, para o operador achar no Excel', () => {
    const arquivo = lerCsv('data;placa;litros\n03/08/2026;ABC-1234;dez');
    const r = conferir(arquivo, ['data', 'placa', 'litros'], converter);
    expect(r.erros[0]?.mensagem).toMatch(/Coluna "litros": "dez" nao e um numero/);
  });

  it('valor obrigatorio ausente aponta a coluna', () => {
    const arquivo = lerCsv('data;placa;litros\n;ABC-1234;10');
    const r = conferir(arquivo, ['data', 'placa', 'litros'], converter);
    expect(r.erros[0]?.mensagem).toMatch(/Coluna "data": valor obrigatorio/);
  });

  it('ErroDeConversao carrega o nome da coluna', () => {
    expect(new ErroDeConversao('litros', 'invalido').message).toBe('Coluna "litros": invalido');
  });
});
