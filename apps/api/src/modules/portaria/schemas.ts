import { z } from 'zod';

/** Contrato de entrada e saida das rotas de portaria (secao 13: toda rota valida schema). */

export const tipoPessoaSchema = z.enum(['VISITANTE', 'MOTORISTA_EXTERNO', 'CLIENTE', 'FORNECEDOR', 'PRESTADOR']);
export const tipoAcessoSchema = z.enum(['PESSOA', 'VEICULO_EXTERNO', 'VEICULO_PROPRIO']);
export const statusAcessoSchema = z.enum(['AGENDADO', 'NO_PATIO', 'EM_TRANSITO', 'ENCERRADO', 'CANCELADO', 'RECUSADO']);
export const gravidadeSchema = z.enum(['BAIXA', 'MEDIA', 'ALTA']);

const hodometro = z.string().regex(/^\d+(\.\d)?$/, 'Hodometro deve ser um numero com ate uma casa decimal.');

export const novaPessoaSchema = z.object({
  unidadeId: z.string().nullish(),
  nome: z.string().min(3, 'Informe o nome completo.'),
  documento: z.string().min(3, 'Informe o documento de identificacao.'),
  tipo: tipoPessoaSchema,
  empresa: z.string().nullish(),
  telefone: z.string().nullish(),
  cnhNumero: z.string().nullish(),
  cnhVencimento: z.coerce.date().nullish(),
  observacao: z.string().nullish(),
});

export const motivoSchema = z.object({
  motivo: z.string().min(5, 'Descreva o motivo com ao menos 5 caracteres.'),
});

export const novoPontoSchema = z.object({
  unidadeId: z.string().nullish(),
  codigo: z.string().min(1, 'Informe o codigo do ponto de acesso.'),
  nome: z.string().min(3, 'Informe o nome da guarita.'),
});

/** Cadastro de rotas (secao 14.2): a guarita escolhe da lista, nunca digita. */
export const novaRotaSchema = z.object({
  unidadeId: z.string().nullish(),
  codigo: z.string().min(2, 'Informe o codigo da rota.').nullish(),
  nome: z.string().min(2, 'Informe o nome da rota.'),
  vendedores: z.coerce.number().int().min(0).max(999).nullish(),
  diasPreVenda: z.coerce.number().int().min(0).max(31).nullish(),
  fechamento: z.string().nullish(),
  largada: z.string().nullish(),
  observacao: z.string().nullish(),
});

export const listagemRotasSchema = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
  unidadeId: z.string().optional(),
  busca: z.string().trim().optional(),
  apenasAtivas: z.coerce.boolean().optional(),
});

export const novoAcessoSchema = z
  .object({
    unidadeId: z.string().nullish(),
    pontoAcessoId: z.string().min(1, 'Informe o ponto de acesso.'),
    tipo: tipoAcessoSchema,
    pessoaExternaId: z.string().nullish(),
    motoristaId: z.string().nullish(),
    veiculoId: z.string().nullish(),
    placaExterna: z.string().nullish(),
    transportadora: z.string().nullish(),
    destino: z.string().nullish(),
    responsavelId: z.string().nullish(),
    motivo: z.string().min(3, 'Informe o motivo da entrada.'),
    previstoPara: z.coerce.date().nullish(),
    cracha: z.string().nullish(),
    rotaId: z.string().nullish(),
    notaFiscal: z.string().nullish(),
    cargaDescricao: z.string().nullish(),
    hodometroSaida: hodometro.nullish(),
    observacao: z.string().nullish(),
    autorizadoPorId: z.string().nullish(),
    justificativaLiberacao: z.string().nullish(),
  })
  .refine((d) => d.tipo !== 'PESSOA' || Boolean(d.pessoaExternaId), {
    message: 'Identifique a pessoa antes de registrar a entrada.',
    path: ['pessoaExternaId'],
  });

export const saidaSchema = z.object({
  crachaDevolvido: z.boolean().default(false),
  hodometroRetorno: hodometro.nullish(),
  observacao: z.string().nullish(),
  abrirOcorrencia: z.boolean().default(false),
});

export const chegadaSchema = z.object({ cracha: z.string().nullish() });

export const encerrarSemEntradaSchema = motivoSchema.extend({
  para: z.enum(['CANCELADO', 'RECUSADO']),
});

export const novaOcorrenciaSchema = z.object({
  unidadeId: z.string().nullish(),
  pontoAcessoId: z.string().nullish(),
  acessoId: z.string().nullish(),
  gravidade: gravidadeSchema.default('BAIXA'),
  descricao: z.string().min(5, 'Descreva a ocorrencia.'),
  ocorridoEm: z.coerce.date().optional(),
  anexoId: z.string().nullish(),
});

export const listagemAcessosSchema = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  unidadeId: z.string().optional(),
  pontoAcessoId: z.string().optional(),
  status: statusAcessoSchema.optional(),
  tipo: tipoAcessoSchema.optional(),
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  busca: z.string().trim().optional(),
});

export const listagemPessoasSchema = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  busca: z.string().trim().optional(),
  tipo: tipoPessoaSchema.optional(),
  apenasBloqueados: z.coerce.boolean().optional(),
});

/**
 * Relatorio de movimento por periodo. O periodo e obrigatorio: relatorio sem
 * recorte varre a tabela inteira e nao responde "o que passou no portao em
 * agosto", que e a pergunta que se faz.
 */
export const relatorioMovimentosSchema = z.object({
  unidadeId: z.string().optional(),
  pontoAcessoId: z.string().optional(),
  veiculoId: z.string().optional(),
  rotaId: z.string().optional(),
  motoristaId: z.string().optional(),
  frota: z.enum(['FROTA', 'TERCEIRO']).optional(),
  de: z.coerce.date({ required_error: 'Informe a data inicial do periodo.' }),
  ate: z.coerce.date({ required_error: 'Informe a data final do periodo.' }),
});

export const patioSchema = z.object({
  unidadeId: z.string().optional(),
  pontoAcessoId: z.string().optional(),
});

export const indicadoresSchema = z.object({
  unidadeId: z.string().optional(),
  dias: z.coerce.number().int().min(1).max(365).default(30),
});

export const listagemOcorrenciasSchema = z.object({
  cursor: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  unidadeId: z.string().optional(),
  gravidade: gravidadeSchema.optional(),
});
