import { z } from 'zod';

/** Contrato das rotas de governanca (secao 13: toda rota valida entrada e saida). */

const decimalPositivo = (campo: string) =>
  z.string().regex(/^\d+(\.\d{1,2})?$/, `${campo} deve ser um valor monetario positivo.`);

export const novoUsuarioSchema = z.object({
  nome: z.string().min(3, 'Informe o nome completo.'),
  email: z.string().email('Informe um e-mail valido.'),
  /** nome de guerra no WinThor; preenchido, a pessoa entra com a senha do WinThor */
  loginWinthor: z.string().trim().max(60).nullish(),
  telefone: z.string().nullish(),
  unidadeId: z.string().nullish(),
  centroCustoId: z.string().nullish(),
  perfis: z.array(z.string()).min(1, 'O usuario precisa de ao menos um perfil.'),
  /** unidades que o usuario alcanca alem da lotacao (secao 5.6) */
  unidades: z.array(z.string()).optional(),
});

export const edicaoUsuarioSchema = z.object({
  nome: z.string().min(3).optional(),
  /** nome de guerra no WinThor; preenchido, a pessoa entra com a senha do WinThor */
  loginWinthor: z.string().trim().max(60).nullish(),
  telefone: z.string().nullish(),
  unidadeId: z.string().nullish(),
  centroCustoId: z.string().nullish(),
  perfis: z.array(z.string()).min(1).optional(),
  unidades: z.array(z.string()).optional(),
});

export const motivoSchema = z.object({
  motivo: z.string().min(5, 'Descreva o motivo com ao menos 5 caracteres.'),
});

/**
 * Reset pelo administrador. Sem `senha`, o servidor gera uma temporaria; com `senha`,
 * usa a informada — util quando a entrega e por telefone. Nos dois casos a troca no
 * primeiro acesso e obrigatoria.
 */
export const redefinirSenhaSchema = z.object({
  senha: z.string().min(1).nullish(),
  /** so vale para senha definida na mao; a gerada sempre exige troca */
  exigirTroca: z.boolean().default(true),
});

export const trocarSenhaSchema = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual.'),
  senhaNova: z.string().min(1, 'Informe a nova senha.'),
});

export const edicaoPerfilSchema = z
  .object({
    descricao: z.string().min(3).optional(),
    permissoes: z.array(z.string()).optional(),
  })
  .refine((d) => d.descricao !== undefined || d.permissoes !== undefined, {
    message: 'Nada a alterar: informe a descricao ou as permissoes.',
  });

export const matrizAlcadasSchema = z.object({
  faixas: z
    .array(
      z.object({
        nivel: z.coerce.number().int().min(1, 'O nivel comeca em 1.'),
        valorMin: decimalPositivo('Piso da faixa'),
        valorMax: decimalPositivo('Teto da faixa').nullable(),
        perfilAprovador: z.string().min(1, 'Informe o perfil aprovador.'),
        propostasMinimas: z.coerce.number().int().min(1, 'Exija ao menos uma proposta.'),
        slaHoras: z.coerce.number().int().min(0, 'O SLA nao pode ser negativo.'),
      }),
    )
    .min(1, 'A matriz precisa de ao menos uma faixa.'),
});

/** O valor do parametro e JSON livre: o tipo e conferido contra o valor atual, no servico. */
export const edicaoParametroSchema = z.object({
  valor: z.unknown(),
});
