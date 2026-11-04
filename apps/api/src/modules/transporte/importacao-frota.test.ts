import { describe, expect, it } from 'vitest';
import {
  acionamentoDoFrio,
  ano,
  data,
  marcaEModelo,
  normalizarPlaca,
  numero,
  statusDoEquipamento,
  statusDoVeiculo,
  tipoDoVeiculo,
  traduzirLinha,
  type LinhaDaPlanilha,
} from './importacao-frota.js';

const linha = (over: Partial<LinhaDaPlanilha> = {}): LinhaDaPlanilha => ({
  placa: 'PTM1J88',
  status: 'ATIVO',
  propriedade: 'DIST. MAR.',
  cnpjProp: '04.897.346/0001-95',
  renavam: '01194964254',
  chassi: '9536E8234LR007384',
  vencCronotacografo: '2027-10-17',
  licenciamento: '2026',
  modelo: 'VW/15.190 CRM 4X2 4P',
  tipo: 'TOCO',
  capacidadeKg: '7500',
  ano: '2019',
  finalidade: 'ENTREGA DIST',
  km: '290200',
  marcaEqFrio: 'CARRIER',
  motorEqFrio: 'DIESEL/ELETRICO',
  anoEqFrio: '2023-07-01',
  numeroSerieEqFrio: 'VKP94324839',
  modeloEqFrio: 'SUPRA 750',
  horimetroEqFrio: '3625',
  statusEqFrio: 'ATIVO',
  obsVeiculo: '',
  obsEqFrio: 'FUNCIONANDO',
  ...over,
});

describe('normalizacao de valores da planilha', () => {
  it('placa perde hifen e vira maiuscula', () => {
    expect(normalizarPlaca(' ptm-1j88 ')).toBe('PTM1J88');
  });

  it.each([
    ['7500', 7500],
    ['7.500', 7500],
    ['270624', 270624],
    ['', null],
    ['NAO TEM', null],
    ['NÃO TEM', null],
    ['S/N', null],
  ])('numero %s vira %s', (bruto, esperado) => {
    expect(numero(bruto)).toBe(esperado);
  });

  it('data ISO da planilha e lida', () => {
    expect(data('2027-10-17')?.toISOString().slice(0, 10)).toBe('2027-10-17');
  });

  it('ano solto vira 1o de janeiro - a planilha nao tem mais precisao', () => {
    expect(data('2014')?.toISOString().slice(0, 10)).toBe('2014-01-01');
  });

  it('"NAO POSSUI" nao vira data', () => {
    expect(data('NÃO POSSUI')).toBeNull();
    expect(data('NAO POSSUI')).toBeNull();
  });

  it('ano aceita data completa e ano solto', () => {
    expect(ano('2018-07-01')).toBe(2018);
    expect(ano('2019')).toBe(2019);
    expect(ano('NÃO TEM')).toBeNull();
  });
});

describe('tipo do veiculo', () => {
  it.each([
    ['TOCO', 'TOCO'],
    ['TRUCK', 'TRUCK'],
    ['TRUCK 3/4', 'TRUCK_TRES_QUARTOS'],
    ['3/4', 'TRES_QUARTOS'],
    ['CAÇAMBA', 'CACAMBA'],
    ['SEMI-REBOQUE', 'SEMI_REBOQUE'],
    ['MOTO', 'MOTO'],
  ])('%s vira %s', (bruto, esperado) => {
    expect(tipoDoVeiculo(bruto).tipo).toBe(esperado);
  });

  it('tipo em branco cai em UTILITARIO, com aviso', () => {
    const r = tipoDoVeiculo('');
    expect(r.tipo).toBe('UTILITARIO');
    expect(r.aviso).toContain('branco');
  });

  it('tipo desconhecido avisa em vez de chutar caminhao', () => {
    const r = tipoDoVeiculo('STRADA');
    expect(r.tipo).toBe('UTILITARIO');
    expect(r.aviso).toContain('STRADA');
  });
});

describe('situacao do veiculo', () => {
  it.each([
    ['ATIVO', 'ATIVO'],
    ['AÇAILANDIA', 'ATIVO'],
    ['CHASSIS', 'ATIVO'],
    ['FERRO E AÇO', 'ATIVO'],
    ['REAL FRUITY/ AÇAILANDIA', 'ATIVO'],
    ['SINISTRO', 'INATIVO'],
    ['VENDIDO - AINDA ESTÁ DIST', 'VENDIDO'],
  ])('%s vira %s', (bruto, esperado) => {
    expect(statusDoVeiculo(bruto).status).toBe(esperado);
  });

  it('o texto original e preservado, porque diz onde o veiculo esta', () => {
    const r = traduzirLinha(linha({ status: 'AÇAILANDIA' }));
    expect(r.veiculo.status).toBe('ATIVO');
    expect(r.veiculo.situacaoDescrita).toBe('AÇAILANDIA');
  });

  it('situacao em branco avisa', () => {
    expect(statusDoVeiculo('').aviso).toContain('branco');
  });
});

describe('marca e modelo', () => {
  it('separa pela barra', () => {
    expect(marcaEModelo('VW/15.190 CRM 4X2 4P')).toEqual({ marca: 'VW', modelo: '15.190 CRM 4X2 4P' });
  });

  it('sem barra, tudo e modelo', () => {
    expect(marcaEModelo('AUMARK S 315L')).toEqual({ marca: null, modelo: 'AUMARK S 315L' });
  });

  it('espaco em volta nao vira parte do nome', () => {
    expect(marcaEModelo(' HONDA/CG 125 FAN KS ')).toEqual({ marca: 'HONDA', modelo: 'CG 125 FAN KS' });
  });
});

describe('equipamento de frio', () => {
  it.each([
    ['DIESEL/ELETRICO', 'DIESEL_ELETRICO'],
    ['ACOPLADO/ELETRICO', 'ACOPLADO_ELETRICO'],
    ['DIESEL', 'DIESEL'],
    ['INOPERANTE', 'INOPERANTE'],
    ['', 'INOPERANTE'],
  ])('acionamento %s vira %s', (bruto, esperado) => {
    expect(acionamentoDoFrio(bruto)).toBe(esperado);
  });

  it('status do equipamento', () => {
    expect(statusDoEquipamento('ATIVO')).toBe('ATIVO');
    expect(statusDoEquipamento('INATIVO')).toBe('INATIVO');
  });

  it('linha com aparelho traz marca, modelo, serie e horimetro', () => {
    const r = traduzirLinha(linha());
    expect(r.equipamento).toEqual({
      marca: 'CARRIER',
      modelo: 'SUPRA 750',
      numeroSerie: 'VKP94324839',
      tipoAcionamento: 'DIESEL_ELETRICO',
      ano: 2023,
      horimetro: '3625.0',
      status: 'ATIVO',
      observacao: 'FUNCIONANDO',
    });
  });

  it('sem marca nao cria equipamento - "INOPERANTE" descreve a ausencia', () => {
    const r = traduzirLinha(linha({ marcaEqFrio: '', motorEqFrio: 'INOPERANTE', modeloEqFrio: '', obsEqFrio: 'NÃO FUNCIONA' }));
    expect(r.equipamento).toBeNull();
  });

  it('serie "S/N" nao vira numero de serie', () => {
    const r = traduzirLinha(linha({ numeroSerieEqFrio: 'S/N' }));
    expect(r.equipamento?.numeroSerie).toBeNull();
  });

  it('horimetro "NÃO TEM" fica nulo, e nao zero', () => {
    const r = traduzirLinha(linha({ horimetroEqFrio: 'NÃO TEM' }));
    expect(r.equipamento?.horimetro).toBeNull();
  });

  it('observacao de aparelho transferido vira aviso para conferencia', () => {
    const r = traduzirLinha(
      linha({ marcaEqFrio: '', modeloEqFrio: '', horimetroEqFrio: '', statusEqFrio: 'INATIVO', obsEqFrio: 'APARELHO FOI PRO SNH3B02' }),
    );
    expect(r.equipamento).toBeNull();
    expect(r.avisos.join(' ')).toContain('APARELHO FOI PRO SNH3B02');
  });
});

describe('linha completa', () => {
  it('traduz o veiculo inteiro', () => {
    const r = traduzirLinha(linha());
    expect(r.veiculo).toMatchObject({
      placa: 'PTM1J88',
      frotaNumero: 'PTM1J88',
      tipo: 'TOCO',
      marca: 'VW',
      modelo: '15.190 CRM 4X2 4P',
      ano: 2019,
      status: 'ATIVO',
      propriedade: 'DIST. MAR.',
      cnpjProprietario: '04.897.346/0001-95',
      capacidadeKg: '7500.00',
      finalidade: 'ENTREGA DIST',
      hodometroAtual: '290200.0',
      licenciamentoAno: 2026,
    });
    expect(r.veiculo.vencimentoCronotacografo?.toISOString().slice(0, 10)).toBe('2027-10-17');
    expect(r.avisos).toEqual([]);
  });

  it('moto sem km fica com hodometro zerado, sem inventar numero', () => {
    const r = traduzirLinha(linha({ tipo: 'MOTO', km: '', marcaEqFrio: '', obsEqFrio: '' }));
    expect(r.veiculo.hodometroAtual).toBe('0.0');
    expect(r.avisos).toEqual([]);
  });

  it('semi-reboque sem chassi nem renavam nao inventa dado', () => {
    const r = traduzirLinha(
      linha({ tipo: 'SEMI-REBOQUE', renavam: '', chassi: '', km: '', capacidadeKg: '', ano: '', marcaEqFrio: '', obsEqFrio: '' }),
    );
    expect(r.veiculo.renavam).toBeNull();
    expect(r.veiculo.chassi).toBeNull();
    expect(r.veiculo.capacidadeKg).toBeNull();
    expect(r.veiculo.ano).toBeNull();
  });
});
