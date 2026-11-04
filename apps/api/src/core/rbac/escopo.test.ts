import { describe, expect, it } from 'vitest';
import type { AccessClaims } from '../auth/tokens.js';
import {
  assegurarUnidade,
  escopoDe,
  filtroUnidade,
  filtroUnidadeEm,
  unidadeDeEscrita,
  unidadesConsultadas,
} from './escopo.js';

const claims = (over: Partial<AccessClaims>): AccessClaims => ({
  sub: 'u1',
  nome: 'Teste',
  email: 'teste@ceara.com',
  perfis: [],
  permissoes: [],
  unidadeId: null,
  centroCustoId: null,
  unidades: [],
  unidadeAtivaId: null,
  ...over,
});

const almoxarife = claims({ unidades: ['MATRIZ'], unidadeAtivaId: 'MATRIZ' });
const comprador = claims({
  permissoes: ['unidade:todas'],
  unidades: ['MATRIZ', 'FILIAL_TERESINA'],
  unidadeAtivaId: 'MATRIZ',
});

describe('escopo de unidade', () => {
  it('reconhece quem opera a rede inteira', () => {
    expect(escopoDe(comprador).todas).toBe(true);
    expect(escopoDe(almoxarife).todas).toBe(false);
  });

  it('prende a listagem do usuario comum a unidade que ele declarou operar', () => {
    expect(filtroUnidade(almoxarife)).toEqual({ unidadeId: 'MATRIZ' });
  });

  it('nao filtra nada para quem ve todas as unidades', () => {
    expect(filtroUnidade(comprador)).toEqual({});
  });

  it('aplica o filtro pedido quando o usuario alcanca aquela unidade', () => {
    expect(filtroUnidade(comprador, 'FILIAL_TERESINA')).toEqual({ unidadeId: 'FILIAL_TERESINA' });
  });

  it('bloqueia o filtro por unidade fora do alcance', () => {
    expect(() => filtroUnidade(almoxarife, 'FILIAL_TERESINA')).toThrow(/nao alcanca/i);
  });

  it('sem unidade ativa e sem alcance global, restringe as unidades do vinculo', () => {
    const semAtiva = claims({ unidades: ['A', 'B'] });
    expect(filtroUnidade(semAtiva)).toEqual({ unidadeId: { in: ['A', 'B'] } });
  });

  it('monta o filtro por relacionamento para tabelas que herdam a unidade', () => {
    expect(filtroUnidadeEm(almoxarife, 'veiculo')).toEqual({ veiculo: { unidadeId: 'MATRIZ' } });
    expect(filtroUnidadeEm(comprador, 'veiculo')).toEqual({});
  });
});

describe('gravacao por unidade', () => {
  it('grava na unidade ativa quando nada e informado', () => {
    expect(unidadeDeEscrita(almoxarife)).toBe('MATRIZ');
  });

  it('respeita a unidade informada quando esta no alcance', () => {
    expect(unidadeDeEscrita(comprador, 'FILIAL_TERESINA')).toBe('FILIAL_TERESINA');
  });

  it('recusa gravar em unidade fora do alcance', () => {
    expect(() => unidadeDeEscrita(almoxarife, 'FILIAL_TERESINA')).toThrow(/nao alcanca/i);
  });

  it('recusa gravar sem unidade em operacao - dado orfao contamina relatorio', () => {
    const semUnidade = claims({});
    expect(() => unidadeDeEscrita(semUnidade)).toThrow(/unidade em operacao/i);
  });

  it('assegurarUnidade passa para quem alcanca e barra o resto', () => {
    expect(() => assegurarUnidade(almoxarife, 'MATRIZ')).not.toThrow();
    expect(() => assegurarUnidade(almoxarife, 'OUTRA')).toThrow();
  });
});

describe('memoria de calculo do relatorio', () => {
  it('registra TODAS quando o relatorio saiu sem recorte', () => {
    expect(unidadesConsultadas(comprador)).toBe('TODAS');
  });

  it('registra a unidade recortada', () => {
    expect(unidadesConsultadas(comprador, 'FILIAL_TERESINA')).toEqual(['FILIAL_TERESINA']);
    expect(unidadesConsultadas(almoxarife)).toEqual(['MATRIZ']);
  });
});
