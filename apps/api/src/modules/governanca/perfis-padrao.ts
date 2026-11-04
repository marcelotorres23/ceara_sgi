import { TODAS_PERMISSOES } from '../../core/rbac/permissions.js';
import { PERMISSOES_VEDADAS_AO_ADMIN } from './regras.js';

/**
 * Os 12 perfis padrao do sistema (secao 5.2).
 *
 * Moram aqui, e nao dentro do seed, por um motivo pratico: enquanto eram uma constante
 * local de um script que roda a si mesmo no import, nenhum teste conseguia olhar para
 * eles. Perfil semeado e regra de acesso — a definicao precisa ser conferivel sem banco.
 *
 * `permissoes` aceita a lista explicita ou uma das duas derivacoes:
 *   - `LEITURA`: tudo que so le, na rede inteira. E o Auditor.
 *   - `TODAS_MENOS_OPERACAO`: administra o sistema sem operar o negocio. E o Administrador.
 */
export interface PerfilPadrao {
  nome: string;
  descricao: string;
  permissoes: string[] | 'TODAS_MENOS_OPERACAO' | 'LEITURA';
}

/** Administrador nao aprova compras nem recebe material (secao 5.2). */
const VEDADAS_AO_ADMIN = new Set<string>(PERMISSOES_VEDADAS_AO_ADMIN);

export const PERFIS_PADRAO: PerfilPadrao[] = [
  {
    nome: 'Solicitante',
    descricao: 'Abre e acompanha solicitacoes do proprio centro de custo.',
    permissoes: ['solicitacao:criar', 'solicitacao:consultar', 'solicitacao:cancelar', 'estoque:consultar'],
  },
  {
    nome: 'Comprador',
    descricao: 'Tria, cota, monta mapa e emite pedido na propria carteira.',
    permissoes: [
      'solicitacao:consultar', 'solicitacao:triar', 'lote:criar', 'lote:consultar',
      'cotacao:gerenciar', 'mapa:gerar', 'pedido:emitir', 'pedido:consultar',
      'fornecedor:gerenciar', 'item:gerenciar', 'estoque:consultar', 'relatorio:operacional',
      // compra e centralizada: o comprador atende todas as unidades da rede (secao 5.6)
      'unidade:listar', 'unidade:todas',
    ],
  },
  {
    nome: 'Coordenador de Suprimentos',
    descricao: 'Tudo do comprador, aprova ate a faixa 2 e reatribui carteira.',
    permissoes: [
      'solicitacao:consultar', 'solicitacao:triar', 'lote:criar', 'lote:consultar', 'lote:reatribuir',
      'cotacao:gerenciar', 'mapa:gerar', 'lote:aprovar', 'pedido:emitir', 'pedido:consultar',
      'fornecedor:gerenciar', 'item:gerenciar', 'estoque:consultar',
      'relatorio:operacional', 'relatorio:gerencial', 'ocorrencia:lancar',
    ],
  },
  {
    nome: 'Gerencia',
    descricao: 'Aprova ate a faixa 3 na sua unidade e acessa relatorios gerenciais.',
    permissoes: [
      'solicitacao:consultar', 'lote:consultar', 'lote:aprovar', 'pedido:consultar',
      'relatorio:operacional', 'relatorio:gerencial', 'colaborador:consultar', 'ocorrencia:decidir',
      'portaria:consultar', 'portaria:gerenciar',
      // a ficha do colaborador e mantida por quem responde pela equipe, e nao pelo admin
      'colaborador:gerenciar',
      'preventiva:consultar',
    ],
  },
  {
    nome: 'Diretoria',
    descricao: 'Aprova sem limite, parametriza alcadas e acessa o painel executivo.',
    permissoes: [
      'lote:consultar', 'lote:aprovar', 'pedido:consultar', 'alcada:listar', 'alcada:editar',
      'parametro:listar', 'relatorio:operacional', 'relatorio:gerencial', 'relatorio:executivo',
      'colaborador:consultar',
    ],
  },
  {
    nome: 'Almoxarife',
    descricao: 'Recebe material, faz three-way match, movimenta e inventaria o proprio almoxarifado.',
    permissoes: [
      'pedido:consultar', 'recebimento:registrar', 'estoque:consultar',
      'movimentacao:registrar', 'inventario:gerenciar', 'relatorio:operacional',
    ],
  },
  {
    nome: 'Fiscal/Financeiro',
    descricao: 'Lanca NF-e, gerencia titulos e bloqueia por divergencia.',
    permissoes: ['pedido:consultar', 'nota_fiscal:lancar', 'titulo:gerenciar', 'relatorio:gerencial'],
  },
  {
    nome: 'Gestor de Frota',
    descricao: 'Veiculos, motoristas, pneus, abastecimento, manutencao e multas.',
    permissoes: [
      'veiculo:gerenciar', 'motorista:gerenciar', 'abastecimento:registrar', 'abastecimento:confirmar',
      'pneu:gerenciar', 'os:gerenciar', 'multa:gerenciar', 'unidade:listar',
      'preventiva:consultar', 'preventiva:registrar', 'preventiva:parametrizar', 'bateria:gerenciar',
      // entrada de combustivel, transferencia e afericao do tanque do patio (secao 7.9)
      'tanque:operar',
      'estoque:consultar', 'solicitacao:criar', 'relatorio:operacional', 'ocorrencia:lancar',
      // trafego dos caminhoes da casa e assunto da frota: consulta, nao operacao de guarita
      'portaria:consultar', 'portaria:gerenciar',
    ],
  },
  {
    nome: 'Motorista',
    // sem 'tanque:operar': abastecer o proprio veiculo nao e lancar entrada no tanque do patio
    descricao: 'Registra abastecimento do proprio veiculo no dia.',
    permissoes: ['abastecimento:registrar'],
  },
  {
    nome: 'Porteiro',
    descricao: 'Registra entrada e saida na guarita. Nao decide lista restritiva nem cadastra ponto de acesso.',
    // sem 'veiculo:gerenciar': a guarita consulta a frota pela propria rota de portaria
    permissoes: ['portaria:operar', 'portaria:consultar'],
  },
  {
    nome: 'Auditor',
    descricao: 'Somente leitura, com acesso total a trilha de auditoria.',
    permissoes: 'LEITURA',
  },
  {
    nome: 'Administrador',
    descricao: 'Usuarios, perfis e parametros. Nao aprova compras nem recebe material.',
    permissoes: 'TODAS_MENOS_OPERACAO',
  },
];

/**
 * Expande a definicao do perfil na lista concreta de permissoes.
 *
 * Auditoria e da rede, e nao da unidade em que o auditor por acaso esta lotado:
 * `unidade:todas` nao termina em `listar` nem em `consultar`, entao o filtro por sufixo a
 * deixava de fora e prendia o auditor a uma unidade — o oposto do que a descricao do
 * perfil promete. Ela nao concede escrita: so amplia o alcance da leitura (secao 5.6).
 */
export function permissoesDoPerfil(def: PerfilPadrao): string[] {
  if (def.permissoes === 'LEITURA') {
    return [...TODAS_PERMISSOES.filter((p) => /:(listar|consultar)$/.test(p)), 'unidade:todas'];
  }
  if (def.permissoes === 'TODAS_MENOS_OPERACAO') {
    return TODAS_PERMISSOES.filter((p) => !VEDADAS_AO_ADMIN.has(p));
  }
  return def.permissoes;
}
