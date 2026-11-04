/**
 * Definicao declarativa de uma tela de cadastro. As cinco telas (veiculo, motorista,
 * item, fornecedor, almoxarifado) compartilham a mesma estrutura: listar com cursor,
 * criar por formulario, e uma ou outra acao no registro.
 *
 * Descrever em dados evita cinco copias da mesma tela divergindo com o tempo.
 */

export type TipoCampo = 'texto' | 'numero' | 'data' | 'selecao' | 'booleano' | 'referencia';

export interface OpcaoCampo {
  valor: string;
  rotulo: string;
}

export interface CampoFormulario {
  nome: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio?: boolean;
  ajuda?: string;
  placeholder?: string;
  opcoes?: OpcaoCampo[];
  /** para tipo `referencia`: de onde buscar as opcoes */
  referencia?: { recurso: string; rotuloCampo: string; valorCampo?: string };
  /** validacao no cliente; o servidor valida de novo */
  validar?: (valor: string) => string | null;
  /** transforma antes de enviar, ex.: placa em maiuscula */
  transformar?: (valor: string) => string;
  /** ocupa a linha inteira no grid de duas colunas */
  largura?: 'inteira';
  padrao?: string;
}

export interface ColunaTabela<T = Record<string, unknown>> {
  chave: string;
  rotulo: string;
  alinhamento?: 'esquerda' | 'direita';
  /** renderizacao customizada; sem isto o valor e exibido cru */
  render?: (registro: T) => React.ReactNode;
}

export interface AcaoRegistro<T = Record<string, unknown>> {
  rotulo: string;
  /** caminho relativo ao recurso, ex.: '/:id/homologar' */
  caminho: (registro: T) => string;
  confirmar?: { titulo: string; descricao: string; exigirMotivo?: boolean };
  /** esconde a acao quando nao se aplica ao registro */
  visivel?: (registro: T) => boolean;
  permissao?: string;
}

export interface DefinicaoCadastro<T = Record<string, unknown>> {
  titulo: string;
  descricao: string;
  recurso: string;
  chaveQuery: string;
  permissaoLer: string;
  permissaoCriar: string;
  /** permissao para editar e inativar; sem ela a coluna de acoes some */
  permissaoEditar: string;
  colunas: Array<ColunaTabela<T>>;
  campos: CampoFormulario[];
  acoes?: Array<AcaoRegistro<T>>;
  vazio: { titulo: string; descricao: string };
  /**
   * Campos que NAO podem ser alterados depois de criados, mesmo estando no formulario.
   * Espelha `camposEditaveis` do servidor - a UI apenas evita a viagem inutil.
   */
  naoEditaveis?: string[];
  /** texto do aviso ao inativar, especifico do recurso */
  avisoInativacao: string;
}
