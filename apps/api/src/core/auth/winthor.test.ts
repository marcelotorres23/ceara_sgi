import { describe, expect, it } from 'vitest';
import { SQL_AUTH_WINTHOR, autenticarWinthor, ehLoginWinthor, normalizarLoginWinthor } from './winthor.js';

describe('login pelo WinThor', () => {
  it('com @ e conta local; sem @ e nome de guerra', () => {
    expect(ehLoginWinthor('admin@cearaalimentos.com.br')).toBe(false);
    expect(ehLoginWinthor('JOAO')).toBe(true);
  });

  it('normaliza como o vinculo e gravado', () => {
    expect(normalizarLoginWinthor('  joao silva ')).toBe('JOAO SILVA');
  });

  it('a senha clara nao volta em coluna: o decrypt fica so no WHERE', () => {
    const [colunas, resto] = SQL_AUTH_WINTHOR.split(/\bFROM\b/i);
    expect(colunas!.toLowerCase()).not.toContain('decrypt');
    expect(colunas!.toLowerCase()).not.toContain('senha');
    expect(resto).toContain('RTRIM(decrypt(senhabd, NVL(usuariobd, nome_guerra))) = :senha');
    expect(resto).toContain("situacao = 'A'");
    expect(resto).toContain('dtdemissao IS NULL');
  });

  it('sem Oracle configurado nao autentica ninguem', async () => {
    expect(await autenticarWinthor('JOAO', 'qualquer')).toBeNull();
  });
});
