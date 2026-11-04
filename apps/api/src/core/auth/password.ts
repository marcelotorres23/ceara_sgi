import argon2 from 'argon2';

/** Parametros Argon2id conforme OWASP (19 MiB, 2 iteracoes, paralelismo 1). */
const OPCOES: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const gerarHashSenha = (senha: string): Promise<string> => argon2.hash(senha, OPCOES);

export async function verificarSenha(hash: string, senha: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, senha);
  } catch {
    return false;
  }
}
