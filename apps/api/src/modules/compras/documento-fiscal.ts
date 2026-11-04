import { chaveValida, emitenteConfere, formatarCnpj } from '../fiscal/chave-nfe.js';

/**
 * Qual documento fecha cada tipo de demanda (secao 6.1.11). Modulo puro.
 *
 * Material sai em **NF-e**: documento estadual de mercadoria, com chave de acesso de 44
 * digitos que carrega o CNPJ do emitente — e por isso a chave da para confrontar contra o
 * fornecedor do pedido e pegar nota lancada no pedido errado.
 *
 * Servico sai em **NFS-e**: documento municipal, cada prefeitura com seu layout, com numero
 * e codigo de verificacao. **Nao tem chave de acesso.** Cobrar chave do servico travaria o
 * fechamento de um fluxo inteiro por um campo que a nota dele nunca vai ter — e aceitar uma
 * chave ali seria aceitar um numero que nao pode ser conferido contra nada.
 */

export type TipoDemanda = 'MATERIAL' | 'SERVICO';

export const documentoDoTipo = (tipo: TipoDemanda): 'NF-e' | 'NFS-e' => (tipo === 'SERVICO' ? 'NFS-e' : 'NF-e');

export interface ProblemaDeDocumento {
  codigo: 'NUMERO_AUSENTE' | 'CHAVE_EM_SERVICO' | 'CHAVE_INVALIDA' | 'EMITENTE_DIVERGENTE';
  mensagem: string;
}

export interface DocumentoInformado {
  tipo: TipoDemanda;
  numero: string | null;
  chave: string | null;
  /** CNPJ do fornecedor do pedido, para confrontar com o emitente da chave */
  cnpjDoFornecedor: string;
  razaoSocialDoFornecedor: string;
}

/**
 * Confere o documento antes de lancar a entrada fiscal.
 *
 * Devolve o primeiro problema, e nao uma lista: sao erros que se resolvem um de cada vez, e
 * empilhar "numero ausente" com "chave invalida" so confunde quem esta digitando.
 */
export function validarDocumentoFiscal(d: DocumentoInformado): ProblemaDeDocumento | null {
  const documento = documentoDoTipo(d.tipo);

  const numero = d.numero?.trim() ?? '';
  if (numero === '') {
    return { codigo: 'NUMERO_AUSENTE', mensagem: `Informe o numero da ${documento} para lancar a entrada fiscal.` };
  }

  const chave = d.chave?.trim() ?? '';

  if (d.tipo === 'SERVICO') {
    if (chave !== '') {
      return {
        codigo: 'CHAVE_EM_SERVICO',
        mensagem: 'Nota de servico (NFS-e) nao tem chave de acesso. Informe apenas o numero da nota.',
      };
    }
    return null;
  }

  // chave e opcional no material: nota antiga e entrada manual nem sempre a tem
  if (chave === '') return null;

  const conferida = chaveValida(chave);
  if (!conferida.valida) return { codigo: 'CHAVE_INVALIDA', mensagem: conferida.motivo! };

  /*
   * A chave carrega o CNPJ do emitente. Confrontar com o fornecedor do pedido pega a nota
   * lancada contra o pedido errado — que o three-way match nao pegaria quando valor e
   * quantidade por acaso coincidem.
   */
  if (!emitenteConfere(conferida.dados!, d.cnpjDoFornecedor)) {
    return {
      codigo: 'EMITENTE_DIVERGENTE',
      mensagem:
        `A chave da NF-e foi emitida pelo CNPJ ${formatarCnpj(conferida.dados!.cnpjEmitente)}, ` +
        `e o pedido e do fornecedor ${d.razaoSocialDoFornecedor} ` +
        `(${formatarCnpj(d.cnpjDoFornecedor)}). Confira a nota.`,
    };
  }

  return null;
}
