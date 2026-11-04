/**
 * Politica de senha (secao 5.1). Modulo puro, sem I/O.
 *
 * O objetivo nao e exigir simbolo estranho que termina em papel colado no monitor:
 * e barrar o que quebra na primeira tentativa - senha curta, o proprio nome, o proprio
 * e-mail, sequencia de teclado e as classicas da regiao.
 */

/**
 * Oito caracteres, nao dez.
 *
 * A regra anterior recusava quase tudo que se digita na pratica e empurrava o
 * administrador para tentativa e erro. Senha que ninguem consegue cadastrar nao protege
 * nada — vira bilhete no monitor, ou a conta fica sem dono.
 */
export const TAMANHO_MINIMO = 8;

export interface ProblemaDeSenha {
  codigo: 'CURTA' | 'CONTEM_IDENTIDADE' | 'SEQUENCIA_OBVIA' | 'IGUAL_A_ANTERIOR' | 'SEM_VARIACAO';
  mensagem: string;
}

/**
 * So o que quebra na primeira tentativa de quem chuta.
 *
 * `ceara` e `admin` sairam da lista: sao o nome da casa e uma palavra comum, e recusar
 * qualquer senha que os contenha barrava o que o administrador naturalmente digita, sem
 * ganho real — a forca vem do resto da senha, nao da ausencia dessas letras.
 */
const OBVIAS = ['123456', '1234567890', 'qwerty', 'asdfgh', 'password', 'abcdef', '000000'];

const semAcento = (texto: string): string => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const normalizar = (texto: string): string => semAcento(texto).toLowerCase();

/** Pedacos identificaveis do nome e do e-mail: "joana.alves@x.com" vira joana, alves. */
function pedacosDaIdentidade(nome: string, email: string): string[] {
  const doEmail = email.split('@')[0] ?? '';
  return [...nome.split(/\s+/), ...doEmail.split(/[._-]+/)]
    .map(normalizar)
    .filter((p) => p.length >= 4);
}

/**
 * Avalia a senha proposta. Lista vazia = pode gravar.
 *
 * `senhaAtualHash` nao entra aqui: comparar hash exige I/O e fica no servico. O que se
 * verifica neste modulo e a senha em si.
 */
export function avaliarSenha(
  senha: string,
  contexto: { nome: string; email: string; igualAAtual?: boolean },
): ProblemaDeSenha[] {
  const problemas: ProblemaDeSenha[] = [];
  const normal = normalizar(senha);

  if (senha.length < TAMANHO_MINIMO) {
    problemas.push({
      codigo: 'CURTA',
      mensagem: `A senha precisa de ao menos ${TAMANHO_MINIMO} caracteres.`,
    });
  }

  // so o caso degenerado: "aaaaaaaa" passa no tamanho e nao protege nada
  if (new Set(normal).size < 2 && senha.length > 0) {
    problemas.push({
      codigo: 'SEM_VARIACAO',
      mensagem: 'A senha repete quase sempre o mesmo caractere. Varie um pouco.',
    });
  }

  /*
   * Identidade: recusa a senha que E o nome ou o e-mail, nao a que os contem.
   * "Joana2026#" e uma senha legitima; "joana" sozinho e o primeiro palpite de quem tenta.
   */
  const identidade = pedacosDaIdentidade(contexto.nome, contexto.email);
  const soLetrasEDigitos = normal.replace(/[^a-z0-9]/g, '');
  if (identidade.some((p) => soLetrasEDigitos === p)) {
    problemas.push({
      codigo: 'CONTEM_IDENTIDADE',
      mensagem: 'A senha nao pode ser apenas seu nome ou seu e-mail — e o primeiro palpite de quem tenta entrar.',
    });
  }

  // a sequencia obvia so reprova quando e a senha inteira, nao quando aparece dentro dela
  if (OBVIAS.includes(soLetrasEDigitos)) {
    problemas.push({
      codigo: 'SEQUENCIA_OBVIA',
      mensagem: 'Esta senha e uma sequencia conhecida. Escolha outra.',
    });
  }

  if (contexto.igualAAtual) {
    problemas.push({
      codigo: 'IGUAL_A_ANTERIOR',
      mensagem: 'A nova senha precisa ser diferente da atual.',
    });
  }

  return problemas;
}

export const senhaAceitavel = (senha: string, contexto: { nome: string; email: string }): boolean =>
  avaliarSenha(senha, contexto).length === 0;

/**
 * Senha temporaria gerada pelo sistema: legivel ao telefone (sem I/l/0/O) e forte o
 * bastante para o intervalo entre a entrega e a troca obrigatoria.
 *
 * O prefixo nao usa o nome da casa: `ceara` esta na lista de sequencias conhecidas, e o
 * sistema gerar uma senha que a propria politica recusaria e incoerente — quem administra
 * repetiria o padrao ao definir a senha na mao, e levaria recusa.
 */
export function gerarSenhaTemporaria(aleatorio: (n: number) => Uint8Array): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = aleatorio(10);
  const corpo = [...bytes].map((b) => alfabeto[b % alfabeto.length]).join('');
  return `Chave@${corpo}`;
}
