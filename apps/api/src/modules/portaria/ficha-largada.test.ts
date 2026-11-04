import { describe, expect, it } from 'vitest';
import {
  gerarFichaDeLargada,
  hodometroFormatado,
  telefoneFormatado,
  type FichaDeLargada,
} from './ficha-largada.js';

const base: FichaDeLargada = {
  protocolo: 'LARGADA 20260908-A1B2C3',
  acessoId: '01927f3a-0000-7000-8000-0000a1b2c3d4',
  largadaEm: new Date('2026-09-08T05:40:00-03:00'),
  geradoEm: new Date('2026-09-08T05:41:00-03:00'),
  unidade: { nome: 'Ceara Alimentos - Matriz', cidade: 'Sao Luis', uf: 'MA' },
  guarita: { codigo: 'G1', nome: 'Guarita principal' },
  registradoPor: 'Porteiro do Turno',
  motorista: {
    nome: 'Jose da Silva',
    cpf: '11122233344',
    cnhNumero: '01234567890',
    cnhCategoria: 'E',
    cnhVencimento: new Date('2027-04-30T00:00:00-03:00'),
    telefone: '98999887766',
  },
  veiculo: { placa: 'SNH3B02', frotaNumero: '212', marca: 'Volkswagen', modelo: 'Delivery 11.180' },
  rota: { codigo: 'ACAILANDIA', nome: 'Acailandia', fechamento: 'quarta', largada: 'quinta' },
  hodometroSaida: '128450.0',
  notaFiscal: '123456',
  cargaDescricao: 'Carga refrigerada — 320 caixas',
  motivo: 'Largada da rota semanal',
  observacao: null,
  ocorrencias: [],
};

const pdf = (f: Partial<FichaDeLargada> = {}) => gerarFichaDeLargada({ ...base, ...f });

/**
 * Paginas do arquivo, lidas do proprio PDF. O pdfkit comprime o conteudo, mas escreve o
 * catalogo em texto — contar aqui e o unico jeito honesto de guardar a regressao de
 * layout: escrita que passe da margem cria pagina, e isso so aparece no arquivo pronto.
 */
const paginas = (arquivo: Buffer): number => {
  const achados = [...arquivo.toString('latin1').matchAll(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/g)];
  if (achados.length === 0) throw new Error('nao encontrei o no de paginas no PDF');
  return Math.max(...achados.map((m) => Number(m[1])));
};

describe('ficha de largada em pdf', () => {
  it('produz um PDF valido', async () => {
    const arquivo = await pdf();
    expect(arquivo.subarray(0, 5).toString()).toBe('%PDF-');
    expect(arquivo.length).toBeGreaterThan(1000);
  });

  it('a ficha cabe em uma pagina, e so uma', async () => {
    // o motorista leva uma folha; duas ja e o comeco de "perdi a segunda"
    expect(paginas(await pdf())).toBe(1);
  });

  it('continua em uma pagina com ocorrencias e textos longos', async () => {
    const arquivo = await pdf({
      cargaDescricao: 'Carga refrigerada. '.repeat(20),
      observacao: 'Motorista saiu com o crachá 14 e devolveu na hora. '.repeat(6),
      ocorrencias: [
        { gravidade: 'MEDIA', descricao: 'Hodometro informado abaixo do cadastro do veiculo.' },
        { gravidade: 'BAIXA', descricao: 'Bau com avaria superficial na porta traseira.' },
      ],
    });
    expect(paginas(arquivo)).toBe(1);
  });

  it('sai mesmo sem rota, veiculo ou motorista identificados', async () => {
    /*
     * A guarita registra o que aconteceu, e nem sempre o cadastro estava completo. A
     * ficha precisa dizer o que faltou — imprimir e mais util que recusar a impressao.
     */
    const arquivo = await pdf({ rota: null, veiculo: null, motorista: null, hodometroSaida: null });
    expect(arquivo.subarray(0, 5).toString()).toBe('%PDF-');
    expect(paginas(arquivo)).toBe(1);
  });
});

describe('formatacao da ficha', () => {
  it('escreve o hodometro com milhar e uma casa', () => {
    expect(hodometroFormatado('128450.0')).toBe('128.450,0 km');
    expect(hodometroFormatado('999.5')).toBe('999,5 km');
    expect(hodometroFormatado(null)).toBe('—');
  });

  it('escreve o telefone como quem le, com e sem o codigo do pais', () => {
    expect(telefoneFormatado('98999887766')).toBe('(98) 99988-7766');
    expect(telefoneFormatado('5598999887766')).toBe('(98) 99988-7766');
    expect(telefoneFormatado('9832221100')).toBe('(98) 3222-1100');
  });

  it('devolve o que veio quando o numero nao tem forma reconhecida', () => {
    // ficha e documento: inventar formato em cima de dado torto esconde o erro do cadastro
    expect(telefoneFormatado('ramal 42')).toBe('ramal 42');
    expect(telefoneFormatado(null)).toBe('—');
  });
});
