import { describe, expect, it } from 'vitest';
import { montarLinha, totalizar, type AcessoParaRelatorio } from './relatorio.js';

const AGORA = new Date('2026-09-04T18:00:00Z');

const acesso = (over: Partial<AcessoParaRelatorio> = {}): AcessoParaRelatorio => ({
  id: 'a1',
  tipo: 'VEICULO_PROPRIO',
  status: 'ENCERRADO',
  createdAt: new Date('2026-09-04T06:00:00Z'),
  entradaEm: new Date('2026-09-04T16:00:00Z'),
  saidaEm: new Date('2026-09-04T06:00:00Z'),
  hodometroSaida: '120000.0',
  hodometroRetorno: '120250.5',
  motivo: 'saida para rota',
  destino: null,
  placaExterna: null,
  transportadora: null,
  veiculo: { placa: 'OJE2683', frotaNumero: '112' },
  motorista: { nome: 'Carlos Motorista' },
  pessoaExterna: null,
  rota: { codigo: 'BAC2', nome: 'BACABAL 2' },
  pontoAcesso: { codigo: 'G1', nome: 'Guarita principal' },
  ...over,
});

describe('linha do relatorio', () => {
  it('traz placa, rota e motorista do caminhao da frota', () => {
    const linha = montarLinha(acesso(), AGORA);

    expect(linha.placa).toBe('OJE2683');
    expect(linha.rota).toBe('BAC2 · BACABAL 2');
    expect(linha.motorista).toBe('Carlos Motorista');
  });

  it('inverte os eventos do caminhao da casa: abre na saida, fecha no retorno', () => {
    const linha = montarLinha(acesso(), AGORA);

    expect(linha.inicioEm).toEqual(new Date('2026-09-04T06:00:00Z'));
    expect(linha.fimEm).toEqual(new Date('2026-09-04T16:00:00Z'));
    expect(linha.permanenciaMinutos).toBe(600);
    expect(linha.kmViagem).toBe('250.5');
  });

  it('no veiculo de terceiro a ordem e a natural: entra e depois sai', () => {
    const linha = montarLinha(
      acesso({
        tipo: 'VEICULO_EXTERNO',
        veiculo: null,
        motorista: null,
        placaExterna: 'ABC1D23',
        pessoaExterna: { nome: 'Jonas Prestador' },
        transportadora: 'Translog',
        rota: null,
        entradaEm: new Date('2026-09-04T08:00:00Z'),
        saidaEm: new Date('2026-09-04T09:30:00Z'),
        hodometroSaida: null,
        hodometroRetorno: null,
      }),
      AGORA,
    );

    expect(linha.placa).toBe('ABC1D23');
    // Terceiro nao tem motorista cadastrado: quem dirige e a pessoa da ficha.
    expect(linha.motorista).toBe('Jonas Prestador');
    expect(linha.inicioEm).toEqual(new Date('2026-09-04T08:00:00Z'));
    expect(linha.permanenciaMinutos).toBe(90);
    expect(linha.kmViagem).toBeNull();
  });

  it('movimento em aberto conta a permanencia ate agora e fica marcado', () => {
    const linha = montarLinha(acesso({ status: 'EM_TRANSITO', entradaEm: null }), AGORA);

    expect(linha.emAberto).toBe(true);
    expect(linha.fimEm).toBeNull();
    expect(linha.permanenciaMinutos).toBe(720);
  });

  it('recusado e cancelado nao sao movimento em aberto', () => {
    expect(montarLinha(acesso({ status: 'RECUSADO' }), AGORA).emAberto).toBe(false);
    expect(montarLinha(acesso({ status: 'CANCELADO' }), AGORA).emAberto).toBe(false);
  });
});

describe('totais do relatorio', () => {
  const linhas = [
    montarLinha(acesso(), AGORA),
    montarLinha(
      acesso({
        id: 'a2',
        saidaEm: new Date('2026-09-04T07:00:00Z'),
        entradaEm: new Date('2026-09-04T13:00:00Z'),
        hodometroSaida: '90000.0',
        hodometroRetorno: '90100.0',
        veiculo: { placa: 'SMK8A84', frotaNumero: '118' },
        rota: { codigo: 'COR2', nome: 'COROATA 2' },
      }),
      AGORA,
    ),
    montarLinha(
      acesso({
        id: 'a3',
        status: 'EM_TRANSITO',
        entradaEm: null,
        hodometroRetorno: null,
      }),
      AGORA,
    ),
  ];

  it('conta movimentos, encerrados e em aberto', () => {
    const totais = totalizar(linhas);

    expect(totais.movimentos).toBe(3);
    expect(totais.encerrados).toBe(2);
    expect(totais.emAberto).toBe(1);
    expect(totais.saidasDaFrota).toBe(3);
  });

  it('a media ignora o que ainda esta na rua', () => {
    // 600 e 360 minutos encerrados; o de 720 esta em aberto e nao entra.
    expect(totalizar(linhas).permanenciaMediaMinutos).toBe(480);
  });

  it('soma o km so de quem tem as duas leituras', () => {
    expect(totalizar(linhas).kmTotal).toBe('350.5');
  });

  it('conta placas e rotas distintas', () => {
    const totais = totalizar(linhas);

    // a1 e a3 sao a mesma placa; a2 e outra.
    expect(totais.veiculosDistintos).toBe(2);
    expect(totais.rotasDistintas).toBe(2);
  });

  it('sem base o indicador e nulo, nunca zero', () => {
    const totais = totalizar([
      montarLinha(
        acesso({
          status: 'EM_TRANSITO',
          entradaEm: null,
          hodometroRetorno: null,
        }),
        AGORA,
      ),
    ]);

    expect(totais.permanenciaMediaMinutos).toBeNull();
    expect(totais.kmTotal).toBeNull();
  });
});
