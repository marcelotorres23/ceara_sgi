/**
 * Traducao da planilha de frota da distribuidora para o cadastro (secao 7.1).
 *
 * Modulo puro, sem I/O. Cada decisao aqui e uma escolha sobre dado que veio de planilha
 * feita por gente: campo livre, abreviacao, "NAO POSSUI", numero escrito como texto.
 * O que nao se entende **nao vira palpite** - fica nulo e aparece no relatorio da
 * importacao, para quem conhece a frota decidir.
 */

export type TipoVeiculo =
  | 'TRUCK'
  | 'TOCO'
  | 'CARRETA'
  | 'UTILITARIO'
  | 'VAN'
  | 'MOTO'
  | 'TRES_QUARTOS'
  | 'TRUCK_TRES_QUARTOS'
  | 'CACAMBA'
  | 'SEMI_REBOQUE';

export type StatusVeiculo = 'ATIVO' | 'MANUTENCAO' | 'INATIVO' | 'VENDIDO';
export type TipoAcionamentoFrio = 'DIESEL' | 'DIESEL_ELETRICO' | 'ACOPLADO_ELETRICO' | 'INOPERANTE';
export type StatusEquipamentoFrio = 'ATIVO' | 'INATIVO' | 'EM_MANUTENCAO';

export interface LinhaDaPlanilha {
  placa: string;
  status: string;
  propriedade: string;
  cnpjProp: string;
  renavam: string;
  chassi: string;
  vencCronotacografo: string;
  licenciamento: string;
  modelo: string;
  tipo: string;
  /** colunas presentes na planilha, hoje sem uso: o bau ainda nao e cadastrado */
  modeloBau?: string;
  anoBau?: string;
  capacidadeKg: string;
  ano: string;
  finalidade: string;
  km: string;
  marcaEqFrio: string;
  motorEqFrio: string;
  anoEqFrio: string;
  numeroSerieEqFrio: string;
  modeloEqFrio: string;
  horimetroEqFrio: string;
  statusEqFrio: string;
  obsVeiculo: string;
  obsEqFrio: string;
}

export interface VeiculoImportado {
  placa: string;
  frotaNumero: string;
  renavam: string | null;
  chassi: string | null;
  tipo: TipoVeiculo;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  status: StatusVeiculo;
  situacaoDescrita: string | null;
  propriedade: string | null;
  cnpjProprietario: string | null;
  capacidadeKg: string | null;
  finalidade: string | null;
  hodometroAtual: string;
  observacao: string | null;
  vencimentoCronotacografo: Date | null;
  licenciamentoAno: number | null;
}

export interface EquipamentoImportado {
  marca: string;
  modelo: string | null;
  numeroSerie: string | null;
  tipoAcionamento: TipoAcionamentoFrio;
  ano: number | null;
  horimetro: string | null;
  status: StatusEquipamentoFrio;
  observacao: string | null;
}

export interface ResultadoDaLinha {
  veiculo: VeiculoImportado;
  equipamento: EquipamentoImportado | null;
  /** o que a planilha dizia e o sistema nao soube traduzir sozinho */
  avisos: string[];
}

// ------------------------------------------------------------------ normalizacao

const texto = (v: string | undefined | null): string => (v ?? '').trim();

const vazio = (v: string | undefined | null): boolean => {
  const t = texto(v).toUpperCase();
  return t === '' || t === 'NAO TEM' || t === 'NÃO TEM' || t === 'NAO POSSUI' || t === 'NÃO POSSUI' || t === 'S/N';
};

const semAcento = (v: string): string => v.normalize('NFD').replace(/[̀-ͯ]/g, '');

const maiusculaSemAcento = (v: string): string => semAcento(texto(v)).toUpperCase();

/** Placa sem hifen e em maiuscula, para nao duplicar cadastro por causa de formatacao. */
export function normalizarPlaca(placa: string): string {
  return texto(placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Numero que veio como texto de planilha: "7.500", "7500,00", "270624". */
export function numero(v: string | undefined | null): number | null {
  if (vazio(v)) return null;
  const limpo = texto(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (limpo === '') return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/**
 * Data que pode vir como data real, como ano solto ("2014") ou como "NAO POSSUI".
 * Ano solto vira 1o de janeiro daquele ano - a planilha nao tem mais precisao que isso.
 */
export function data(v: string | undefined | null): Date | null {
  if (vazio(v)) return null;
  const t = texto(v);

  if (/^\d{4}$/.test(t)) {
    const ano = Number(t);
    return ano >= 1950 && ano <= 2100 ? new Date(Date.UTC(ano, 0, 1)) : null;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (br) return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));

  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Ano de quatro digitos, aceitando data completa. */
export function ano(v: string | undefined | null): number | null {
  const d = data(v);
  if (d) return d.getUTCFullYear();
  const n = numero(v);
  return n !== null && n >= 1950 && n <= 2100 ? n : null;
}

// ------------------------------------------------------------------ mapeamentos

const TIPOS: Array<[RegExp, TipoVeiculo]> = [
  [/^TRUCK\s*3\/4$/, 'TRUCK_TRES_QUARTOS'],
  [/^TRUCK$/, 'TRUCK'],
  [/^TOCO$/, 'TOCO'],
  [/^3\/4$/, 'TRES_QUARTOS'],
  [/^CACAMBA$/, 'CACAMBA'],
  [/^SEMI[\s-]?REBOQUE$/, 'SEMI_REBOQUE'],
  [/^CARRETA$/, 'CARRETA'],
  [/^MOTO$/, 'MOTO'],
  [/^VAN$/, 'VAN'],
];

/**
 * Tipo do veiculo. Sem correspondencia, cai em UTILITARIO com aviso: a planilha deixa
 * o campo vazio em picape e caminhao leve, e chutar TRUCK falsearia o mapa de rodagem.
 */
export function tipoDoVeiculo(valor: string): { tipo: TipoVeiculo; aviso: string | null } {
  const t = maiusculaSemAcento(valor);
  for (const [padrao, tipo] of TIPOS) {
    if (padrao.test(t)) return { tipo, aviso: null };
  }
  return {
    tipo: 'UTILITARIO',
    aviso: t === '' ? 'Tipo em branco na planilha: classificado como UTILITARIO.' : `Tipo "${valor}" desconhecido: classificado como UTILITARIO.`,
  };
}

/**
 * Situacao do veiculo.
 *
 * A coluna STATUS mistura duas coisas: se o veiculo roda ("ATIVO", "SINISTRO") e onde
 * ele esta ou a quem serve ("ACAILANDIA", "REAL FRUITY", "CHASSIS"). O enum guarda a
 * primeira; o texto original fica em `situacaoDescrita`, porque a segunda tambem importa.
 */
export function statusDoVeiculo(valor: string): { status: StatusVeiculo; aviso: string | null } {
  const t = maiusculaSemAcento(valor);

  if (t.includes('SINISTRO') || t.includes('INCENDIO')) return { status: 'INATIVO', aviso: null };
  // "VENDIDO - AINDA ESTA DIST": ja nao e nosso, mesmo estando no patio
  if (t.includes('VENDIDO')) return { status: 'VENDIDO', aviso: null };
  if (t.includes('MANUTENCAO') || t.includes('OFICINA')) return { status: 'MANUTENCAO', aviso: null };
  if (t.includes('INATIVO') || t.includes('BAIXAD')) return { status: 'INATIVO', aviso: null };
  if (t === '') return { status: 'ATIVO', aviso: 'Situacao em branco na planilha: cadastrado como ATIVO.' };

  // o resto - ATIVO, ACAILANDIA, CHASSIS, REAL FRUITY, FERRO E ACO - continua rodando
  return { status: 'ATIVO', aviso: null };
}

/** "VW/15.190 CRM 4X2 4P" -> marca VW, modelo "15.190 CRM 4X2 4P". */
export function marcaEModelo(valor: string): { marca: string | null; modelo: string | null } {
  const t = texto(valor);
  if (t === '') return { marca: null, modelo: null };

  const barra = t.indexOf('/');
  if (barra < 0) return { marca: null, modelo: t };

  const marca = t.slice(0, barra).trim();
  const modelo = t.slice(barra + 1).trim();
  return { marca: marca || null, modelo: modelo || null };
}

const ACIONAMENTOS: Array<[RegExp, TipoAcionamentoFrio]> = [
  [/ACOPLADO/, 'ACOPLADO_ELETRICO'],
  [/DIESEL\s*\/\s*ELETRICO/, 'DIESEL_ELETRICO'],
  [/INOPERANTE/, 'INOPERANTE'],
  [/DIESEL/, 'DIESEL'],
];

export function acionamentoDoFrio(valor: string): TipoAcionamentoFrio {
  const t = maiusculaSemAcento(valor);
  for (const [padrao, tipo] of ACIONAMENTOS) if (padrao.test(t)) return tipo;
  return 'INOPERANTE';
}

export function statusDoEquipamento(valor: string): StatusEquipamentoFrio {
  const t = maiusculaSemAcento(valor);
  if (t.includes('INATIVO')) return 'INATIVO';
  if (t.includes('MANUTENCAO')) return 'EM_MANUTENCAO';
  return 'ATIVO';
}

// ------------------------------------------------------------------ traducao da linha

/**
 * Traduz uma linha. `frotaNumero` nao existe na planilha: usa-se a placa, que e unica
 * e e como a operacao se refere ao veiculo no dia a dia.
 */
export function traduzirLinha(linha: LinhaDaPlanilha): ResultadoDaLinha {
  const avisos: string[] = [];
  const placa = normalizarPlaca(linha.placa);

  const { tipo, aviso: avisoTipo } = tipoDoVeiculo(linha.tipo);
  if (avisoTipo) avisos.push(avisoTipo);

  const { status, aviso: avisoStatus } = statusDoVeiculo(linha.status);
  if (avisoStatus) avisos.push(avisoStatus);

  const { marca, modelo } = marcaEModelo(linha.modelo);
  const km = numero(linha.km);
  if (km === null && !vazio(linha.km)) avisos.push(`KM "${linha.km}" nao reconhecido: hodometro ficou zerado.`);

  const situacao = texto(linha.status);
  const obs = [texto(linha.obsVeiculo)].filter((t) => t !== '').join(' · ');

  const veiculo: VeiculoImportado = {
    placa,
    frotaNumero: placa,
    renavam: vazio(linha.renavam) ? null : texto(linha.renavam),
    chassi: vazio(linha.chassi) ? null : texto(linha.chassi),
    tipo,
    marca,
    modelo,
    ano: ano(linha.ano),
    status,
    situacaoDescrita: situacao === '' ? null : situacao,
    propriedade: vazio(linha.propriedade) ? null : texto(linha.propriedade),
    cnpjProprietario: vazio(linha.cnpjProp) ? null : texto(linha.cnpjProp),
    capacidadeKg: numero(linha.capacidadeKg)?.toFixed(2) ?? null,
    finalidade: vazio(linha.finalidade) ? null : texto(linha.finalidade),
    hodometroAtual: (km ?? 0).toFixed(1),
    observacao: obs === '' ? null : obs,
    vencimentoCronotacografo: data(linha.vencCronotacografo),
    licenciamentoAno: ano(linha.licenciamento),
  };

  return { veiculo, equipamento: traduzirEquipamento(linha, avisos), avisos };
}

/**
 * O equipamento so existe se a planilha identificar a marca. Linha com apenas
 * "INOPERANTE" na coluna de motor descreve a ausencia do aparelho, nao um aparelho.
 */
function traduzirEquipamento(linha: LinhaDaPlanilha, avisos: string[]): EquipamentoImportado | null {
  if (vazio(linha.marcaEqFrio)) {
    const obs = texto(linha.obsEqFrio);
    if (obs !== '' && !/NAO FUNCIONA|NÃO FUNCIONA/i.test(obs) && !/CACAMBA|CAÇAMBA/i.test(obs)) {
      avisos.push(`Sem marca do equipamento de frio, mas ha observacao: "${obs}".`);
    }
    return null;
  }

  const horimetro = numero(linha.horimetroEqFrio);
  const obsFrio = texto(linha.obsEqFrio);

  return {
    marca: texto(linha.marcaEqFrio),
    modelo: vazio(linha.modeloEqFrio) ? null : texto(linha.modeloEqFrio),
    numeroSerie: vazio(linha.numeroSerieEqFrio) ? null : texto(linha.numeroSerieEqFrio),
    tipoAcionamento: acionamentoDoFrio(linha.motorEqFrio),
    ano: ano(linha.anoEqFrio),
    horimetro: horimetro?.toFixed(1) ?? null,
    status: statusDoEquipamento(linha.statusEqFrio),
    observacao: obsFrio === '' ? null : obsFrio,
  };
}
