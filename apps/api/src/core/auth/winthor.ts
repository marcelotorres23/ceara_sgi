import oracledb from 'oracledb';
import { env } from '../env.js';

/**
 * Login pelo WinThor, no mesmo molde do BI de comissao: nome de guerra + senha do ERP.
 *
 * A PCEMPR nao tem coluna de senha clara; o WinThor guarda o segredo em SENHABD e a mascara
 * em USUARIOBD (ou NOME_GUERRA, quando vazia). `decrypt` e a funcao do proprio schema.
 * A comparacao fica no WHERE: a senha clara nunca volta do banco nem passa por log.
 */
export const SQL_AUTH_WINTHOR = `
SELECT matricula, nome, nome_guerra, email
  FROM pcempr
 WHERE situacao = 'A'
   AND dtdemissao IS NULL
   AND senhabd IS NOT NULL
   AND UPPER(TRIM(nome_guerra)) = UPPER(TRIM(:nome_guerra))
   AND RTRIM(decrypt(senhabd, NVL(usuariobd, nome_guerra))) = :senha
 FETCH FIRST 1 ROW ONLY`;

export interface EmpregadoWinthor {
  matricula: number;
  nome: string;
  /** chave do vinculo com `usuarios.login_winthor`, sempre em maiusculas */
  nomeGuerra: string;
  /** e-mail do cadastro no WinThor; muitos estao vazios */
  email: string | null;
}

export const winthorConfigurado = (): boolean =>
  Boolean(env.ORACLE_USER && env.ORACLE_PASSWORD && env.ORACLE_DSN);

/** Com @ e conta local (senha do SGI); sem @ e o nome de guerra do WinThor. */
export const ehLoginWinthor = (login: string): boolean => !login.includes('@');

/** Normaliza o login digitado para comparar com o vinculo gravado. */
export const normalizarLoginWinthor = (login: string): string => login.trim().toUpperCase();

/**
 * Devolve o empregado ou null. Falha de conexao tambem vira null - quem chama responde
 * "credenciais invalidas" sem revelar se o problema foi a senha ou o Oracle; o log diz qual.
 */
export async function autenticarWinthor(
  login: string,
  senha: string,
  aoFalhar: (erro: unknown) => void = () => undefined,
): Promise<EmpregadoWinthor | null> {
  const nomeGuerra = normalizarLoginWinthor(login);
  if (!nomeGuerra || !senha || !winthorConfigurado()) return null;

  let conexao: oracledb.Connection | undefined;
  try {
    conexao = await oracledb.getConnection({
      user: env.ORACLE_USER,
      password: env.ORACLE_PASSWORD,
      connectString: env.ORACLE_DSN,
    });
    const r = await conexao.execute<[number, string | null, string | null, string | null]>(
      SQL_AUTH_WINTHOR,
      { nome_guerra: nomeGuerra, senha },
      { outFormat: oracledb.OUT_FORMAT_ARRAY },
    );
    const linha = r.rows?.[0];
    if (!linha) return null;
    const [matricula, nome, guerra, email] = linha;
    return {
      matricula,
      nome: (nome ?? guerra ?? nomeGuerra).trim(),
      nomeGuerra: normalizarLoginWinthor(guerra ?? nomeGuerra),
      email: email?.trim().toLowerCase() || null,
    };
  } catch (erro) {
    aoFalhar(erro);
    return null;
  } finally {
    await conexao?.close().catch(() => undefined);
  }
}
