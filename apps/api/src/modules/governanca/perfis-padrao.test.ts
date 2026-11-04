import { describe, expect, it } from 'vitest';
import { TODAS_PERMISSOES } from '../../core/rbac/permissions.js';
import { PERFIS_PADRAO, permissoesDoPerfil } from './perfis-padrao.js';
import { validarPermissoesDoPerfil } from './regras.js';

const porNome = (nome: string) => {
  const def = PERFIS_PADRAO.find((p) => p.nome === nome);
  if (!def) throw new Error(`perfil ${nome} sumiu da lista padrao`);
  return permissoesDoPerfil(def);
};

/** Acoes que escrevem. Serve para provar que um perfil de leitura so le. */
const ESCREVE = /:(criar|editar|inativar|gerenciar|registrar|lancar|emitir|operar|triar|aprovar|cancelar|reatribuir|decidir|gerar|parametrizar)$/;

describe('perfis padrao', () => {
  it('todo perfil semeado passa na mesma validacao da tela', () => {
    for (const def of PERFIS_PADRAO) {
      const problemas = validarPermissoesDoPerfil(def.nome, permissoesDoPerfil(def), TODAS_PERMISSOES);
      expect(problemas, `${def.nome}: ${problemas.map((p) => p.mensagem).join(' | ')}`).toEqual([]);
    }
  });

  it('nenhuma permissao do catalogo fica sem dono', () => {
    // permissao que ninguem tem e tela que so o Administrador alcanca — quase sempre e esquecimento
    const concedidas = new Set(PERFIS_PADRAO.flatMap(permissoesDoPerfil));
    const orfas = TODAS_PERMISSOES.filter((p) => !concedidas.has(p));
    expect(orfas).toEqual([]);
  });

  it('nenhum perfil e vazio', () => {
    for (const def of PERFIS_PADRAO) {
      expect(permissoesDoPerfil(def).length, def.nome).toBeGreaterThan(0);
    }
  });

  describe('Administrador', () => {
    const admin = () => porNome('Administrador');

    it('administra o sistema', () => {
      expect(admin()).toEqual(expect.arrayContaining(['usuario:criar', 'perfil:editar', 'parametro:editar', 'auditoria:consultar']));
    });

    it('nao opera a cadeia de compras', () => {
      // barrar so `lote:aprovar` nao segrega nada: quem cota e emite pedido so precisa de
      // um aprovador de fachada (regra de ouro 5)
      for (const p of ['solicitacao:triar', 'lote:criar', 'cotacao:gerenciar', 'mapa:gerar', 'pedido:emitir', 'lote:aprovar']) {
        expect(admin(), p).not.toContain(p);
      }
    });

    it('nao recebe material, nao mexe no estoque e nao paga', () => {
      for (const p of ['recebimento:registrar', 'nota_fiscal:lancar', 'movimentacao:registrar', 'inventario:gerenciar', 'titulo:gerenciar']) {
        expect(admin(), p).not.toContain(p);
      }
    });
  });

  describe('Auditor', () => {
    it('alcanca a rede inteira, e nao so a unidade onde esta lotado', () => {
      expect(porNome('Auditor')).toContain('unidade:todas');
    });

    it('le a trilha de auditoria', () => {
      expect(porNome('Auditor')).toContain('auditoria:consultar');
    });

    it('nao escreve nada', () => {
      expect(porNome('Auditor').filter((p) => ESCREVE.test(p))).toEqual([]);
    });
  });

  describe('Motorista', () => {
    it('registra o proprio abastecimento', () => {
      expect(porNome('Motorista')).toContain('abastecimento:registrar');
    });

    it('nao movimenta o tanque do patio', () => {
      /*
       * A regressao que este teste guarda: entrada de combustivel, transferencia e afericao
       * nasceram exigindo `abastecimento:registrar`, a unica permissao do motorista. A mesma
       * credencial que lancava o proprio abastecimento tambem lancava a entrada que o cobre.
       */
      expect(porNome('Motorista')).not.toContain('tanque:operar');
    });
  });

  describe('Gestor de Frota', () => {
    it('opera o tanque do patio', () => {
      expect(porNome('Gestor de Frota')).toContain('tanque:operar');
    });
  });

  describe('Gerencia', () => {
    it('mantem a ficha do colaborador', () => {
      // sem isto o cadastro de colaboradores so era alcancavel pelo Administrador
      expect(porNome('Gerencia')).toContain('colaborador:gerenciar');
    });
  });
});
