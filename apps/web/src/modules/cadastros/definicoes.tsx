import { Badge } from '../../design-system/components/Badge';
import type { DefinicaoCadastro } from './tipos';

interface Registro extends Record<string, unknown> {
  id: string;
}

const data = (valor: unknown): string =>
  valor ? new Intl.DateTimeFormat('pt-BR').format(new Date(String(valor))) : '—';

const numero = (valor: unknown, casas = 0): string =>
  valor == null || valor === ''
    ? '—'
    : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
        .format(Number(valor));

/** Placa nos dois formatos vigentes: ABC-1234 e ABC1D23 (Mercosul). */
const validarPlaca = (v: string): string | null =>
  /^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/.test(v.toUpperCase())
    ? null
    : 'Use o formato ABC-1234 ou ABC1D23.';

const somenteDigitos = (v: string): string => v.replace(/\D/g, '');

const validarCnpj = (v: string): string | null =>
  somenteDigitos(v).length === 14 ? null : 'O CNPJ tem 14 digitos.';

const validarCpf = (v: string): string | null =>
  somenteDigitos(v).length === 11 ? null : 'O CPF tem 11 digitos.';

/**
 * Telefone brasileiro com DDD - a mesma regra que o backend usa para montar o numero
 * do WhatsApp. Sem DDD nao da para mandar nada, e o cadastro precisa recusar isso aqui
 * e nao na hora em que a ficha de largada tenta sair.
 */
const validarTelefone = (v: string): string | null => {
  const d = somenteDigitos(v);
  const semPais = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
  return semPais.length === 10 || semPais.length === 11 ? null : 'Informe DDD + numero, ex.: 98999887766.';
};

const validarDecimal = (v: string): string | null =>
  /^\d+([.,]\d{1,4})?$/.test(v) ? null : 'Informe um numero, ex.: 400 ou 400,5.';

/** O backend espera ponto decimal; a pessoa digita virgula. */
const paraDecimal = (v: string): string => v.replace(',', '.');

const naoPodeSerPassado = (v: string): string | null => {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return new Date(`${v}T00:00:00`) < hoje ? 'A data de vencimento nao pode estar no passado.' : null;
};

// ---------------------------------------------------------------- veiculos

export const veiculos: DefinicaoCadastro<Registro> = {
  titulo: 'Veiculos',
  descricao: 'Frota cadastrada. A placa identifica o veiculo na portaria, no abastecimento e no plano de manutencao.',
  recurso: '/transporte/veiculos',
  chaveQuery: 'cadastro-veiculos',
  permissaoLer: 'veiculo:gerenciar',
  permissaoCriar: 'veiculo:gerenciar',
  permissaoEditar: 'veiculo:gerenciar',
  // o hodometro avanca pelo abastecimento; editar a mao corromperia o consumo apurado
  naoEditaveis: ['hodometroAtual'],
  avisoInativacao:
    'O veiculo deixa de aparecer no patio e no abastecimento. O historico e preservado e ele pode ser reativado depois.',
  vazio: { titulo: 'Nenhum veiculo cadastrado', descricao: 'Cadastre o primeiro veiculo para acompanhar o plano de manutencao.' },
  colunas: [
    { chave: 'placa', rotulo: 'Placa', render: (r) => <span className="font-mono">{String(r.placa)}</span> },
    { chave: 'frotaNumero', rotulo: 'Frota' },
    { chave: 'tipo', rotulo: 'Tipo' },
    { chave: 'modelo', rotulo: 'Modelo', render: (r) => `${r.marca ?? ''} ${r.modelo ?? ''}`.trim() || '—' },
    { chave: 'hodometroAtual', rotulo: 'Hodometro', alinhamento: 'direita', render: (r) => numero(r.hodometroAtual, 1) },
    {
      chave: 'status',
      rotulo: 'Situacao',
      render: (r) => (
        <Badge tom={r.status === 'ATIVO' ? 'verde' : r.status === 'MANUTENCAO' ? 'ouro' : 'neutro'}>
          {String(r.status)}
        </Badge>
      ),
    },
  ],
  campos: [
    { nome: 'placa', rotulo: 'Placa', tipo: 'texto', obrigatorio: true, placeholder: 'ABC1D23', validar: validarPlaca, transformar: (v) => v.toUpperCase() },
    { nome: 'frotaNumero', rotulo: 'Numero de frota', tipo: 'texto', obrigatorio: true, ajuda: 'Identificacao interna, unica.' },
    {
      nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', obrigatorio: true,
      // os quatro ultimos vieram da planilha da frota real (secao 7.1)
      opcoes: ['TRUCK', 'TOCO', 'TRUCK_TRES_QUARTOS', 'TRES_QUARTOS', 'CARRETA', 'SEMI_REBOQUE', 'CACAMBA', 'UTILITARIO', 'VAN', 'MOTO']
        .map((v) => ({ valor: v, rotulo: v.replaceAll('_', ' ') })),
    },
    { nome: 'marca', rotulo: 'Marca', tipo: 'texto' },
    { nome: 'modelo', rotulo: 'Modelo', tipo: 'texto' },
    { nome: 'ano', rotulo: 'Ano', tipo: 'numero', validar: (v) => (/^\d{4}$/.test(v) ? null : 'Informe o ano com 4 digitos.') },
    { nome: 'renavam', rotulo: 'RENAVAM', tipo: 'texto' },
    { nome: 'chassi', rotulo: 'Chassi', tipo: 'texto' },
    { nome: 'propriedade', rotulo: 'Propriedade', tipo: 'texto', ajuda: 'De qual empresa do grupo e o veiculo.' },
    { nome: 'cnpjProprietario', rotulo: 'CNPJ do proprietario', tipo: 'texto' },
    { nome: 'capacidadeKg', rotulo: 'Capacidade de carga (kg)', tipo: 'numero', validar: validarDecimal, transformar: paraDecimal },
    { nome: 'finalidade', rotulo: 'Finalidade', tipo: 'texto', placeholder: 'ENTREGA DIST', ajuda: 'A que o veiculo serve: entrega, coleta, passeio.' },
    {
      nome: 'situacaoDescrita', rotulo: 'Situacao descrita', tipo: 'texto',
      ajuda: 'Como a operacao descreve: "ACAILANDIA", "CHASSIS", "VENDIDO - AINDA ESTA DIST". A situacao acima diz se roda; esta diz o resto.',
    },
    { nome: 'capacidadeTanque', rotulo: 'Capacidade do tanque (L)', tipo: 'numero', validar: validarDecimal, transformar: paraDecimal, ajuda: 'Usada para detectar litragem acima do tanque.' },
    { nome: 'hodometroAtual', rotulo: 'Hodometro atual', tipo: 'numero', padrao: '0', validar: validarDecimal, transformar: paraDecimal },
    { nome: 'configEixos', rotulo: 'Configuracao de eixos', tipo: 'texto', placeholder: '6x2' },
    { nome: 'observacao', rotulo: 'Observacao', tipo: 'texto' },
  ],
};

// ---------------------------------------------------------------- motoristas

export const motoristas: DefinicaoCadastro<Registro> = {
  titulo: 'Motoristas',
  descricao: 'CNH, exame toxicologico e ASO vencidos impedem a saida do veiculo.',
  recurso: '/transporte/motoristas',
  chaveQuery: 'cadastro-motoristas',
  permissaoLer: 'motorista:gerenciar',
  permissaoCriar: 'motorista:gerenciar',
  permissaoEditar: 'motorista:gerenciar',
  avisoInativacao:
    'O motorista deixa de aparecer na guarita e no abastecimento. O historico e preservado e ele pode ser reativado depois.',
  vazio: { titulo: 'Nenhum motorista cadastrado', descricao: 'Cadastre os motoristas para vincular as viagens e aos abastecimentos.' },
  colunas: [
    { chave: 'nome', rotulo: 'Nome' },
    { chave: 'cnhCategoria', rotulo: 'CNH', render: (r) => `${r.cnhNumero} · ${r.cnhCategoria}` },
    { chave: 'cnhVencimento', rotulo: 'CNH vence', render: (r) => data(r.cnhVencimento) },
    {
      chave: 'telefone', rotulo: 'WhatsApp',
      render: (r) => (r.telefone ? String(r.telefone) : <Badge tom="ouro">sem numero</Badge>),
    },
    { chave: 'toxicologicoVencimento', rotulo: 'Toxicologico', render: (r) => data(r.toxicologicoVencimento) },
    { chave: 'asoVencimento', rotulo: 'ASO', render: (r) => data(r.asoVencimento) },
    {
      chave: 'status', rotulo: 'Situacao',
      render: (r) => <Badge tom={r.status === 'ATIVO' ? 'verde' : 'neutro'}>{String(r.status)}</Badge>,
    },
  ],
  campos: [
    { nome: 'nome', rotulo: 'Nome completo', tipo: 'texto', obrigatorio: true, largura: 'inteira' },
    { nome: 'cpf', rotulo: 'CPF', tipo: 'texto', obrigatorio: true, validar: validarCpf, transformar: somenteDigitos, placeholder: '00000000000' },
    {
      nome: 'telefone', rotulo: 'Telefone (WhatsApp)', tipo: 'texto',
      validar: validarTelefone, transformar: somenteDigitos, placeholder: '98999887766',
      ajuda: 'Numero para onde a ficha de largada e enviada quando o caminhao sai para a rota.',
    },
    { nome: 'cnhNumero', rotulo: 'Numero da CNH', tipo: 'texto', obrigatorio: true },
    {
      nome: 'cnhCategoria', rotulo: 'Categoria', tipo: 'selecao', obrigatorio: true,
      opcoes: ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'].map((v) => ({ valor: v, rotulo: v })),
    },
    { nome: 'cnhVencimento', rotulo: 'Vencimento da CNH', tipo: 'data', obrigatorio: true, validar: naoPodeSerPassado },
    { nome: 'toxicologicoVencimento', rotulo: 'Vencimento do toxicologico', tipo: 'data' },
    { nome: 'asoVencimento', rotulo: 'Vencimento do ASO', tipo: 'data' },
    {
      nome: 'veiculoPadraoId', rotulo: 'Veiculo padrao', tipo: 'referencia',
      referencia: { recurso: '/transporte/veiculos?limite=100', rotuloCampo: 'placa' },
      ajuda: 'Sugerido na saida do veiculo pela guarita.',
    },
  ],
};

// ---------------------------------------------------------------- itens

export const itens: DefinicaoCadastro<Registro> = {
  titulo: 'Catalogo de itens',
  descricao: 'Catalogo curado: item novo entra em homologacao antes de poder ser comprado.',
  recurso: '/compras/itens',
  chaveQuery: 'cadastro-itens',
  permissaoLer: 'solicitacao:consultar',
  permissaoCriar: 'item:gerenciar',
  permissaoEditar: 'item:gerenciar',
  avisoInativacao:
    'O item volta a reprovado e nao pode mais ser solicitado. A inativacao e recusada se houver saldo em estoque ou solicitacao em andamento.',
  vazio: { titulo: 'Nenhum item no catalogo', descricao: 'Cadastre os itens que a operacao compra com frequencia.' },
  colunas: [
    { chave: 'codigo', rotulo: 'Codigo', render: (r) => <span className="font-mono">{String(r.codigo)}</span> },
    { chave: 'descricao', rotulo: 'Descricao' },
    { chave: 'unidadeMedida', rotulo: 'UM' },
    {
      chave: 'critico', rotulo: 'Critico',
      render: (r) => (r.critico ? <Badge tom="vermelho">Critico</Badge> : <span className="text-ceara-texto2">—</span>),
    },
    {
      chave: 'statusHomologacao', rotulo: 'Homologacao',
      render: (r) => (
        <Badge tom={r.statusHomologacao === 'HOMOLOGADO' ? 'verde' : r.statusHomologacao === 'REPROVADO' ? 'vermelho' : 'ouro'}>
          {String(r.statusHomologacao)}
        </Badge>
      ),
    },
  ],
  campos: [
    { nome: 'codigo', rotulo: 'Codigo interno', tipo: 'texto', obrigatorio: true, placeholder: 'PN-0001' },
    { nome: 'unidadeMedida', rotulo: 'Unidade de medida', tipo: 'texto', obrigatorio: true, placeholder: 'UN, KG, L' },
    { nome: 'descricao', rotulo: 'Descricao', tipo: 'texto', obrigatorio: true, largura: 'inteira' },
    { nome: 'especificacao', rotulo: 'Especificacao tecnica', tipo: 'texto', largura: 'inteira' },
    { nome: 'critico', rotulo: 'Item critico (ruptura para a operacao)', tipo: 'booleano', largura: 'inteira' },
  ],
  acoes: [
    {
      rotulo: 'Homologar',
      caminho: (r) => `/${r.id}/homologar`,
      visivel: (r) => r.statusHomologacao !== 'HOMOLOGADO',
      permissao: 'item:gerenciar',
      confirmar: {
        titulo: 'Homologar item',
        descricao: 'O item passa a poder ser solicitado e comprado. A acao fica registrada na trilha.',
      },
    },
  ],
};

// ---------------------------------------------------------------- fornecedores

export const fornecedores: DefinicaoCadastro<Registro> = {
  titulo: 'Fornecedores',
  descricao: 'Fornecedor bloqueado nao pode ser cotado. A homologacao vale por um ano.',
  recurso: '/compras/fornecedores',
  chaveQuery: 'cadastro-fornecedores',
  permissaoLer: 'solicitacao:consultar',
  permissaoCriar: 'fornecedor:gerenciar',
  permissaoEditar: 'fornecedor:gerenciar',
  avisoInativacao:
    'O fornecedor passa a bloqueado e nao pode ser cotado. A inativacao e recusada se houver pedido em aberto.',
  vazio: { titulo: 'Nenhum fornecedor cadastrado', descricao: 'Cadastre fornecedores para poder enviar cotacoes.' },
  colunas: [
    { chave: 'razaoSocial', rotulo: 'Razao social' },
    { chave: 'cnpj', rotulo: 'CNPJ', render: (r) => <span className="font-mono">{String(r.cnpj)}</span> },
    { chave: 'condicaoPadrao', rotulo: 'Condicao padrao' },
    { chave: 'homologacaoValidaAte', rotulo: 'Homologado ate', render: (r) => data(r.homologacaoValidaAte) },
    {
      chave: 'status', rotulo: 'Situacao',
      render: (r) => (
        <Badge tom={r.status === 'HOMOLOGADO' ? 'verde' : r.status === 'BLOQUEADO' ? 'vermelho' : 'ouro'}>
          {String(r.status)}
        </Badge>
      ),
    },
  ],
  campos: [
    { nome: 'razaoSocial', rotulo: 'Razao social', tipo: 'texto', obrigatorio: true, largura: 'inteira' },
    { nome: 'nomeFantasia', rotulo: 'Nome fantasia', tipo: 'texto' },
    { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'texto', obrigatorio: true, validar: validarCnpj, transformar: somenteDigitos, placeholder: '00000000000000' },
    { nome: 'condicaoPadrao', rotulo: 'Condicao de pagamento padrao', tipo: 'texto', placeholder: '28 dias', largura: 'inteira' },
  ],
  acoes: [
    {
      rotulo: 'Homologar',
      caminho: (r) => `/${r.id}/homologar`,
      visivel: (r) => r.status !== 'HOMOLOGADO',
      permissao: 'fornecedor:gerenciar',
      confirmar: {
        titulo: 'Homologar fornecedor',
        descricao: 'O fornecedor passa a poder ser cotado, com validade de um ano a partir de hoje.',
      },
    },
  ],
};

// ---------------------------------------------------------------- almoxarifados

export const almoxarifados: DefinicaoCadastro<Registro> = {
  titulo: 'Almoxarifados',
  descricao: 'Cada almoxarifado tem saldo e custo medio proprios por item.',
  recurso: '/almoxarifado/almoxarifados',
  chaveQuery: 'cadastro-almoxarifados',
  permissaoLer: 'estoque:consultar',
  permissaoCriar: 'inventario:gerenciar',
  permissaoEditar: 'inventario:gerenciar',
  avisoInativacao:
    'O almoxarifado deixa de receber movimentacao. A inativacao e recusada se ainda houver saldo em estoque.',
  vazio: { titulo: 'Nenhum almoxarifado cadastrado', descricao: 'Cadastre ao menos um para receber material do estoque.' },
  colunas: [
    { chave: 'codigo', rotulo: 'Codigo', render: (r) => <span className="font-mono">{String(r.codigo)}</span> },
    { chave: 'nome', rotulo: 'Nome' },
    {
      chave: '_count', rotulo: 'Itens com saldo', alinhamento: 'direita',
      render: (r) => numero((r._count as { saldos?: number } | undefined)?.saldos ?? 0),
    },
  ],
  campos: [
    { nome: 'codigo', rotulo: 'Codigo', tipo: 'texto', obrigatorio: true, placeholder: 'ALM-01' },
    { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
    {
      nome: 'unidadeId', rotulo: 'Unidade', tipo: 'referencia', obrigatorio: true,
      referencia: { recurso: '/unidades', rotuloCampo: 'nome' },
      largura: 'inteira',
    },
  ],
};

// ---------------------------------------------------------------- rotas

/**
 * Rotas comerciais de pre-venda e entrega (secao 14.2).
 *
 * O cadastro nasceu da planilha do comercial e continua podendo ser reimportado; a tela
 * existe para o dia a dia — rota nova, vendedor a mais, dia de largada que mudou.
 */
export const rotas: DefinicaoCadastro<Registro> = {
  titulo: 'Rotas',
  descricao: 'O roteiro que o comercial opera. E dele que a guarita escolhe a rota na saida do caminhao.',
  recurso: '/portaria/rotas',
  chaveQuery: 'cadastro-rotas',
  permissaoLer: 'portaria:consultar',
  permissaoCriar: 'portaria:gerenciar',
  permissaoEditar: 'portaria:gerenciar',
  avisoInativacao:
    'A rota deixa de aparecer na guarita. As saidas ja registradas nela continuam intactas, e a inativacao ' +
    'e recusada se houver caminhao em viagem.',
  vazio: {
    titulo: 'Nenhuma rota cadastrada',
    descricao: 'Cadastre as rotas para a guarita escolher na saida do caminhao, em vez de digitar.',
  },
  naoEditaveis: ['codigo'],
  colunas: [
    { chave: 'codigo', rotulo: 'Codigo', render: (r) => <span className="font-mono">{String(r.codigo)}</span> },
    { chave: 'nome', rotulo: 'Rota' },
    { chave: 'vendedores', rotulo: 'Vendedores', alinhamento: 'direita', render: (r) => numero(r.vendedores) },
    { chave: 'diasPreVenda', rotulo: 'Dias de pre-venda', alinhamento: 'direita', render: (r) => numero(r.diasPreVenda) },
    { chave: 'fechamento', rotulo: 'Fechamento' },
    { chave: 'largada', rotulo: 'Largada' },
  ],
  campos: [
    { nome: 'nome', rotulo: 'Rota', tipo: 'texto', obrigatorio: true, placeholder: 'BACABAL 1' },
    {
      nome: 'codigo', rotulo: 'Codigo', tipo: 'texto',
      ajuda: 'Em branco, sai do nome sem acento (BACABAL 1 vira BACABAL-1). Nao muda depois.',
      placeholder: 'BACABAL-1',
    },
    { nome: 'vendedores', rotulo: 'Numero de vendedores', tipo: 'numero' },
    { nome: 'diasPreVenda', rotulo: 'Dias de pre-venda', tipo: 'numero' },
    { nome: 'fechamento', rotulo: 'Fechamento', tipo: 'texto', placeholder: 'SABADO' },
    { nome: 'largada', rotulo: 'Largada', tipo: 'texto', placeholder: 'SEGUNDA' },
    { nome: 'observacao', rotulo: 'Observacao', tipo: 'texto', largura: 'inteira' },
  ],
};

export const CADASTROS = { veiculos, motoristas, itens, fornecedores, almoxarifados, rotas } as const;
export type ChaveCadastro = keyof typeof CADASTROS;
