/**
 * Catalogo de permissoes `recurso:acao` (secao 5.1).
 * O backend sempre valida; a UI apenas esconde.
 * Perfis sao editaveis em tela - este arquivo define o universo possivel, nao o vinculo.
 */

export const PERMISSOES = [
  // governanca
  ['usuario', 'listar', 'Listar usuarios'],
  ['usuario', 'criar', 'Criar usuario'],
  ['usuario', 'editar', 'Editar usuario'],
  ['usuario', 'inativar', 'Inativar usuario'],
  ['perfil', 'listar', 'Listar perfis'],
  ['perfil', 'editar', 'Editar perfil e suas permissoes'],
  ['alcada', 'listar', 'Consultar matriz de alcadas'],
  ['alcada', 'editar', 'Parametrizar matriz de alcadas'],
  ['parametro', 'listar', 'Consultar parametros do sistema'],
  ['parametro', 'editar', 'Editar parametros do sistema'],
  ['auditoria', 'consultar', 'Consultar trilha de auditoria'],
  ['unidade', 'listar', 'Consultar unidades'],
  ['unidade', 'gerenciar', 'Cadastrar e editar unidades'],
  ['unidade', 'todas', 'Operar e consultar todas as unidades'],

  // compras (M1) - reservados desde F0 para o seed de perfis
  ['solicitacao', 'criar', 'Abrir solicitacao de compra'],
  ['solicitacao', 'consultar', 'Consultar solicitacoes'],
  ['solicitacao', 'cancelar', 'Cancelar solicitacao com motivo'],
  ['solicitacao', 'triar', 'Triar e validar especificacao'],
  ['lote', 'criar', 'Agrupar solicitacoes em lote'],
  ['lote', 'consultar', 'Consultar lotes'],
  ['lote', 'reatribuir', 'Reatribuir lote a outro comprador'],
  ['cotacao', 'gerenciar', 'Enviar e registrar cotacoes'],
  ['mapa', 'gerar', 'Gerar mapa de cotacao'],
  ['lote', 'aprovar', 'Aprovar lote dentro da alcada'],
  ['pedido', 'emitir', 'Emitir pedido de compra'],
  ['pedido', 'consultar', 'Consultar pedidos'],
  ['recebimento', 'registrar', 'Registrar recebimento e three-way match'],
  ['nota_fiscal', 'lancar', 'Lancar entrada fiscal'],
  ['titulo', 'gerenciar', 'Gerenciar contas a pagar'],
  ['fornecedor', 'gerenciar', 'Cadastrar e homologar fornecedores'],
  ['item', 'gerenciar', 'Curar catalogo de itens'],

  // transporte (M2)
  ['veiculo', 'gerenciar', 'Cadastrar e editar veiculos'],
  ['motorista', 'gerenciar', 'Cadastrar e editar motoristas'],
  ['abastecimento', 'registrar', 'Registrar abastecimento e consultar tanques'],
  ['abastecimento', 'confirmar', 'Conferir e confirmar os abastecimentos do dia na agenda'],
  ['tanque', 'operar', 'Dar entrada de combustivel, transferir entre tanques e aferir'],
  ['pneu', 'gerenciar', 'Gerenciar pneus e rodizio'],
  ['bateria', 'gerenciar', 'Controlar baterias, medicoes e ponto de troca'],
  ['os', 'gerenciar', 'Gerenciar ordens de servico'],
  ['preventiva', 'consultar', 'Consultar o controle de oleo e servicos periodicos'],
  ['preventiva', 'registrar', 'Registrar troca de oleo, alinhamento e balanceamento'],
  ['preventiva', 'parametrizar', 'Definir os intervalos dos planos de servico periodico'],
  ['multa', 'gerenciar', 'Registrar e tratar multas'],

  // almoxarifado (M3)
  ['estoque', 'consultar', 'Consultar saldos e alertas'],
  ['movimentacao', 'registrar', 'Registrar entrada, saida e transferencia'],
  ['inventario', 'gerenciar', 'Conduzir inventario ciclico'],

  // pessoas (M4)
  ['colaborador', 'consultar', 'Consultar ficha do colaborador'],
  ['colaborador', 'gerenciar', 'Cadastrar e editar colaboradores'],
  ['ocorrencia', 'lancar', 'Lancar ocorrencia de pontuacao'],
  ['ocorrencia', 'decidir', 'Decidir contestacao de ocorrencia'],

  // portaria (M6)
  ['portaria', 'operar', 'Registrar entrada, saida e ocorrencia na guarita'],
  ['portaria', 'consultar', 'Consultar patio, historico e indicadores da portaria'],
  ['portaria', 'gerenciar', 'Cadastrar pontos de acesso, pessoas externas e lista restritiva'],

  // BI (M5)
  ['relatorio', 'operacional', 'Relatorios operacionais'],
  ['relatorio', 'gerencial', 'Relatorios gerenciais'],
  ['relatorio', 'executivo', 'Painel executivo'],
] as const satisfies ReadonlyArray<readonly [string, string, string]>;

type Entrada = (typeof PERMISSOES)[number];
/** Distribui sobre a uniao de tuplas - so gera os pares que existem no catalogo. */
export type Permissao = Entrada extends readonly [infer R extends string, infer A extends string, string]
  ? `${R}:${A}`
  : never;

export const chavePermissao = (recurso: string, acao: string): string => `${recurso}:${acao}`;

export const TODAS_PERMISSOES: string[] = PERMISSOES.map(([r, a]) => chavePermissao(r, a));
