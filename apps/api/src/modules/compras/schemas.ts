import { z } from 'zod';
import { chaveValida, normalizarChave } from '../fiscal/chave-nfe.js';

/**
 * Chave da NF-e validada de verdade: 44 digitos, UF, mes, modelo e digito
 * verificador mod-11 (F10). So o tamanho deixava passar erro de digitacao.
 */
export const chaveNfeSchema = z
  .string()
  .transform(normalizarChave)
  .superRefine((chave, ctx) => {
    const r = chaveValida(chave);
    if (!r.valida) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.motivo! });
  });

/** Valor monetario/quantidade como string decimal - nunca float no transporte. */
const decimalString = (campo: string) =>
  z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, `${campo} deve ser um numero decimal positivo com ate 4 casas.`);

export const criticidadeSchema = z.enum(['P1', 'P2', 'P3', 'P4']);

export const novaSolicitacaoSchema = z.object({
  centroCustoId: z.string().min(1, 'Informe o centro de custo.'),
  /** material ou servico: define o documento fiscal do fechamento (secao 6.1.11) */
  tipo: z.enum(['MATERIAL', 'SERVICO']).default('MATERIAL'),
  criticidade: criticidadeSchema,
  origemDemanda: z.string().min(3, 'Descreva a origem da demanda.'),
  dataLimite: z.coerce.date(),
  itens: z
    .array(
      z.object({
        itemId: z.string().nullish(),
        descricaoLivre: z.string().nullish(),
        quantidade: decimalString('Quantidade'),
        unidadeMedida: z.string().min(1, 'Informe a unidade de medida.'),
        observacao: z.string().nullish(),
      }),
    )
    .min(1, 'Informe ao menos um item.'),
});

export const motivoSchema = z.object({
  motivo: z.string().min(5, 'Informe o motivo com ao menos 5 caracteres.'),
});

export const novoLoteSchema = z.object({
  solicitacaoIds: z.array(z.string().min(1)).min(1, 'Selecione ao menos uma solicitacao.'),
});

export const transicaoSchema = z.object({
  para: z.enum([
    'RASCUNHO', 'TRIAGEM', 'EM_COTACAO', 'MAPA_PRONTO', 'AGUARDANDO_APROVACAO', 'APROVADO',
    'PEDIDO_EMITIDO', 'AGUARDANDO_ENTREGA', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'NF_LANCADA', 'ENCERRADO',
    'DEVOLVIDO_AO_SOLICITANTE', 'EM_RENEGOCIACAO', 'REPROVADO', 'CANCELADO', 'BLOQUEADO_DIVERGENCIA',
  ]),
  motivo: z.string().nullish(),
});

export const abrirCotacoesSchema = z.object({
  fornecedorIds: z.array(z.string().min(1)).min(1, 'Selecione ao menos um fornecedor.'),
});

export const respostaCotacaoSchema = z.object({
  condicaoPagamento: z.string().min(1, 'Informe a condicao de pagamento.'),
  prazoDias: z.coerce.number().int().min(0, 'Prazo nao pode ser negativo.'),
  descontoAvista: decimalString('Desconto').nullish(),
  freteTipo: z.enum(['CIF', 'FOB']),
  freteValor: decimalString('Frete').nullish(),
  prazoEntregaDias: z.coerce.number().int().min(0),
  itens: z
    .array(
      z.object({
        solicitacaoItemId: z.string().min(1),
        precoUnitario: decimalString('Preco unitario'),
        quantidade: decimalString('Quantidade'),
        marcaOfertada: z.string().nullish(),
      }),
    )
    .min(1, 'Informe o preco de ao menos um item.'),
});

/** Evidencia da cotacao: print, e-mail ou PDF do orcamento (secao 6.1.5). */
export const evidenciaCotacaoSchema = z.object({
  conteudoBase64: z.string().min(16, 'Envie o arquivo da evidencia.'),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  nome: z.string().min(1).max(160),
  descricao: z.string().max(160).nullish(),
});

/** Arquivo da nota fiscal do recebimento: DANFE, XML da NF-e, NFS-e ou foto da nota. */
export const notaFiscalAnexoSchema = z.object({
  conteudoBase64: z.string().min(16, 'Envie o arquivo da nota fiscal.'),
  mime: z.enum([
    'application/pdf',
    'text/xml',
    'application/xml',
    'application/octet-stream',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]),
  nome: z.string().min(1).max(160),
  descricao: z.string().max(160).nullish(),
});

export const gerarMapaSchema = z.object({
  cotacaoEscolhidaId: z.string().nullish(),
  justificativa: z.string().nullish(),
});

export const decisaoAprovacaoSchema = z.object({
  decisao: z.enum(['APROVADO', 'APROVADO_COM_RESSALVA', 'DEVOLVIDO', 'REPROVADO']),
  ressalva: z.string().nullish(),
  motivo: z.string().nullish(),
});

export const emitirPedidoSchema = z.object({
  dataPrometida: z.coerce.date(),
});

export const reprogramarPedidoSchema = z.object({
  dataPrometida: z.coerce.date(),
  motivo: z.string().min(5, 'Informe o motivo da reprogramacao.'),
});

export const novoFornecedorSchema = z.object({
  razaoSocial: z.string().min(3),
  nomeFantasia: z.string().nullish(),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 digitos, apenas numeros.'),
  condicaoPadrao: z.string().nullish(),
});

export const novoItemSchema = z.object({
  codigo: z.string().min(1),
  descricao: z.string().min(3),
  especificacao: z.string().nullish(),
  unidadeMedida: z.string().min(1),
  familiaId: z.string().nullish(),
  critico: z.boolean().default(false),
});

export const painelSchema = z.object({
  criticidade: criticidadeSchema.optional(),
  centroCusto: z.string().optional(),
  fornecedorId: z.string().optional(),
  valorMin: decimalString('Valor minimo').optional(),
  valorMax: decimalString('Valor maximo').optional(),
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  apenasMeus: z.coerce.boolean().optional(),
  apenasAtrasados: z.coerce.boolean().optional(),
  swimlane: z.enum(['CRITICIDADE', 'COMPRADOR', 'CENTRO_CUSTO']).optional(),
});

/** Fila do aprovador: so lotes aguardando decisao, opcionalmente de um centro de custo. */
export const filaAprovacaoSchema = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(20),
  unidadeId: z.string().optional(),
  centroCustoId: z.string().optional(),
});

export const historicoCentroCustoSchema = z.object({
  meses: z.coerce.number().int().min(1).max(36).default(12),
  unidadeId: z.string().optional(),
});

export const moverCardSchema = transicaoSchema.extend({
  loteId: z.string().min(1, 'Informe o lote.'),
});

export const notaSchema = z.object({
  texto: z.string().min(3, 'Escreva a nota com ao menos 3 caracteres.'),
});

export const reatribuirSchema = z.object({
  compradorId: z.string().min(1, 'Informe o novo comprador.'),
  motivo: z.string().min(5, 'Informe o motivo da reatribuicao.'),
});

export const recebimentoSchema = z.object({
  nfNumero: z.string().nullish(),
  nfChave: z.string().regex(/^\d{44}$/, 'A chave da NF-e tem 44 digitos.').nullish(),
  nfValor: decimalString('Valor da NF-e').nullish(),
  nfEmitidaEm: z.coerce.date().nullish(),
  observacao: z.string().nullish(),
  itens: z
    .array(
      z.object({
        pedidoItemId: z.string().min(1),
        quantidadeRecebida: decimalString('Quantidade recebida'),
        precoNotaFiscal: decimalString('Preco da NF-e').nullish(),
        divergenciaManual: z.enum(['ESPECIFICACAO', 'AVARIA', 'DOCUMENTACAO']).nullish(),
        observacao: z.string().nullish(),
        anexoId: z.string().nullish(),
      }),
    )
    .min(1, 'Informe ao menos um item conferido.'),
});

export const entradaFiscalSchema = z.object({
  vencimento: z.coerce.date(),
  condicao: z.string().nullish(),
  nfNumero: z.string().nullish(),
  nfChave: z.string().regex(/^\d{44}$/, 'A chave da NF-e tem 44 digitos.').nullish(),
});

export const listagemSchema = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().optional(),
  criticidade: criticidadeSchema.optional(),
  busca: z.string().trim().optional(),
  apenasMeus: z.coerce.boolean().optional(),
  /** recorte por unidade; so quem tem `unidade:todas` escolhe outra que nao a ativa */
  unidadeId: z.string().optional(),
});
