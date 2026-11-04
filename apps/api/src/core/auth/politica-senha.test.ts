import { describe, expect, it } from 'vitest';
import { TAMANHO_MINIMO, avaliarSenha, gerarSenhaTemporaria, senhaAceitavel } from './politica-senha.js';

const PESSOA = { nome: 'Joana Alves Ribeiro', email: 'joana.alves@cearaalimentos.com.br' };

const codigos = (senha: string, ctx = PESSOA) => avaliarSenha(senha, ctx).map((p) => p.codigo);

describe('tamanho', () => {
  it('senha curta e recusada', () => {
    expect(codigos('Tri#9k')).toContain('CURTA');
  });

  it(`senha com ${TAMANHO_MINIMO} caracteres passa no tamanho`, () => {
    expect(codigos('Trilho#9')).not.toContain('CURTA');
  });

  it('senha vazia acusa tamanho e nao quebra', () => {
    expect(codigos('')).toContain('CURTA');
  });
});

describe('variacao', () => {
  it('repeticao do mesmo caractere e recusada mesmo sendo longa', () => {
    expect(codigos('aaaaaaaaaaaa')).toContain('SEM_VARIACAO');
  });

  it('duas letras alternadas ja contam como variacao suficiente', () => {
    // a regra so barra o caso degenerado; policiar mais que isso empurra para o papel colado
    expect(codigos('ababababab')).not.toContain('SEM_VARIACAO');
  });

  it('senha variada passa', () => {
    expect(codigos('Trilho#9k2')).not.toContain('SEM_VARIACAO');
  });
});

/**
 * A regra recusa a senha que E a identidade, nao a que a contem: "Joana2026#" e legitima,
 * "joana" sozinho e o primeiro palpite de quem tenta.
 */
describe('identidade da pessoa', () => {
  it('senha que e so o proprio nome e recusada', () => {
    expect(codigos('joana', { nome: 'Joana Alves', email: 'j@x.com' })).toContain('CONTEM_IDENTIDADE');
  });

  it('senha que e so a parte do e-mail antes do arroba e recusada', () => {
    expect(codigos('marcos', { nome: 'Marcos Pereira', email: 'marcos@x.com' })).toContain('CONTEM_IDENTIDADE');
  });

  it('nome com numero e simbolo em volta passa', () => {
    expect(codigos('Joana2026#')).not.toContain('CONTEM_IDENTIDADE');
  });

  it('sobrenome dentro de uma senha maior passa', () => {
    expect(codigos('xxRibeiro#77')).not.toContain('CONTEM_IDENTIDADE');
  });

  it('acento e maiuscula nao driblam a regra', () => {
    expect(codigos('JOÃNA', { nome: 'Joana Alves', email: 'j@x.com' })).toContain('CONTEM_IDENTIDADE');
  });
});

describe('sequencias conhecidas', () => {
  it.each(['123456', 'qwerty', 'password', 'Abcdef'])('%s sozinha e recusada', (senha) => {
    expect(codigos(senha, { nome: 'Marcos Pereira', email: 'marcos@x.com' })).toContain('SEQUENCIA_OBVIA');
  });

  it('a sequencia dentro de uma senha maior nao reprova', () => {
    expect(codigos('Trilho123456', { nome: 'Marcos Pereira', email: 'marcos@x.com' })).not.toContain(
      'SEQUENCIA_OBVIA',
    );
  });

  it('o nome da casa deixou de ser proibido', () => {
    // 'ceara' saiu da lista: barrava o que o administrador digita, sem ganho real
    expect(avaliarSenha('Ceara@2026', { nome: 'Marcos Pereira', email: 'marcos@x.com' })).toEqual([]);
  });

  it('senha comum de administrador passa', () => {
    expect(avaliarSenha('Admin@2026', { nome: 'Marcos Pereira', email: 'marcos@x.com' })).toEqual([]);
  });

  it('senha sem sequencia conhecida passa', () => {
    expect(avaliarSenha('Trilho#9k2', PESSOA)).toEqual([]);
  });
});

describe('repeticao da senha anterior', () => {
  it('igual a atual e recusada', () => {
    expect(codigos2('Trilho#9k2', true)).toContain('IGUAL_A_ANTERIOR');
  });

  it('diferente da atual passa', () => {
    expect(codigos2('Trilho#9k2', false)).toEqual([]);
  });

  function codigos2(senha: string, igualAAtual: boolean) {
    return avaliarSenha(senha, { ...PESSOA, igualAAtual }).map((p) => p.codigo);
  }
});

describe('senha aceitavel', () => {
  it('resume a avaliacao', () => {
    expect(senhaAceitavel('Trilho#9k2', PESSOA)).toBe(true);
    expect(senhaAceitavel('joana', PESSOA)).toBe(false);
  });

  it('aceita o que um administrador realmente digita', () => {
    for (const senha of ['Ceara@2026', 'Frota@2026', 'Mudar@123', 'Senha@2026']) {
      expect(senhaAceitavel(senha, { nome: 'Marcos Pereira', email: 'marcos@x.com' })).toBe(true);
    }
  });
});

describe('senha temporaria gerada', () => {
  const aleatorio = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7);

  it('tem prefixo legivel e corpo de 10 caracteres', () => {
    const s = gerarSenhaTemporaria(aleatorio);
    expect(s.startsWith('Chave@')).toBe(true);
    expect(s.length).toBe(16);
  });

  it('nao usa caracteres que se confundem ao telefone', () => {
    const corpo = gerarSenhaTemporaria((n) => Uint8Array.from({ length: n }, (_, i) => i)).slice(6);
    expect(corpo).not.toMatch(/[IO01l]/);
  });

  it('a temporaria passa na propria politica', () => {
    // invariante: o sistema nao pode gerar senha que ele mesmo recusaria se digitada
    const s = gerarSenhaTemporaria(aleatorio);
    expect(s.length).toBeGreaterThanOrEqual(TAMANHO_MINIMO);
    expect(avaliarSenha(s, { nome: 'Joana Alves', email: 'joana.alves@x.com' })).toEqual([]);
  });

  it('a temporaria nao usa o nome da casa, que a politica recusa', () => {
    expect(gerarSenhaTemporaria(aleatorio).toLowerCase()).not.toContain('ceara');
  });
});
