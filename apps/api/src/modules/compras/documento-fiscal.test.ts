import { describe, expect, it } from 'vitest';
import { documentoDoTipo, validarDocumentoFiscal, type DocumentoInformado } from './documento-fiscal.js';
import { digitoVerificador } from '../fiscal/chave-nfe.js';

const CNPJ = '11222333000181';

/**
 * Chave de 44 digitos com DV valido, montada no layout do manual da NF-e:
 * cUF(2) AAMM(4) CNPJ(14) modelo(2) serie(3) numero(9) tpEmis(1) cNF(8) DV(1).
 */
const chaveDe = (cnpj: string): string => {
  const corpo = `21` + `2608` + cnpj + `55` + `001` + `000045678` + `1` + `00045678`;
  return `${corpo}${digitoVerificador(corpo)}`;
};

const base: DocumentoInformado = {
  tipo: 'MATERIAL',
  numero: '45678',
  chave: null,
  cnpjDoFornecedor: CNPJ,
  razaoSocialDoFornecedor: 'Distribuidora Alfa Pecas LTDA',
};

const conferir = (d: Partial<DocumentoInformado> = {}) => validarDocumentoFiscal({ ...base, ...d });

describe('documento fiscal por tipo de demanda', () => {
  it('material fecha com NF-e e servico com NFS-e', () => {
    expect(documentoDoTipo('MATERIAL')).toBe('NF-e');
    expect(documentoDoTipo('SERVICO')).toBe('NFS-e');
  });

  it('numero e obrigatorio nos dois, com o nome do documento certo na mensagem', () => {
    expect(conferir({ numero: null })?.mensagem).toContain('NF-e');
    expect(conferir({ tipo: 'SERVICO', numero: null })?.mensagem).toContain('NFS-e');
    expect(conferir({ numero: '   ' })?.codigo).toBe('NUMERO_AUSENTE');
  });

  it('servico com so o numero passa', () => {
    /*
     * A NFS-e e municipal e nao tem chave de acesso. Exigir chave aqui travaria o
     * fechamento do fluxo de servico inteiro num campo que a nota dele nunca vai ter.
     */
    expect(conferir({ tipo: 'SERVICO', numero: '2026/1188', chave: null })).toBeNull();
  });

  it('chave informada em servico e recusada, e nao ignorada', () => {
    // aceitar calado gravaria um numero que ninguem consegue conferir contra nada
    const p = conferir({ tipo: 'SERVICO', chave: chaveDe(CNPJ) });
    expect(p?.codigo).toBe('CHAVE_EM_SERVICO');
    expect(p?.mensagem).toContain('NFS-e');
  });

  it('material sem chave passa: nota antiga e lancamento manual nem sempre tem', () => {
    expect(conferir({ chave: null })).toBeNull();
    expect(conferir({ chave: '' })).toBeNull();
  });

  it('material com chave valida do proprio fornecedor passa', () => {
    expect(conferir({ chave: chaveDe(CNPJ) })).toBeNull();
  });

  it('chave malformada e recusada', () => {
    expect(conferir({ chave: '123' })?.codigo).toBe('CHAVE_INVALIDA');
  });

  it('chave de outro emitente e recusada com os dois CNPJ na mensagem', () => {
    // pega a nota lancada no pedido errado, que o three-way match nao pegaria
    // quando valor e quantidade por acaso coincidem
    const p = conferir({ chave: chaveDe('44555666000172') });
    expect(p?.codigo).toBe('EMITENTE_DIVERGENTE');
    expect(p?.mensagem).toContain('Distribuidora Alfa Pecas LTDA');
  });

  it('espacos em volta da chave nao mudam a decisao', () => {
    expect(conferir({ chave: `  ${chaveDe(CNPJ)}  ` })).toBeNull();
  });
});
