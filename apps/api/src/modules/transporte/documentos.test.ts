import { describe, expect, it } from 'vitest';
import {
  classificarDocumento,
  diasAte,
  impedimentos,
  montarPainelDocumentos,
  type DocumentoParaConferir,
} from './documentos.js';

const AGORA = new Date('2026-08-10T08:00:00-03:00');
const emDias = (d: number): Date => new Date(AGORA.getTime() + d * 86_400_000);

const doc = (over: Partial<DocumentoParaConferir> = {}): DocumentoParaConferir => ({
  id: 'd1',
  tipo: 'CRLV',
  origem: 'veiculo',
  origemId: 'v1',
  identificacao: 'ABC-1234',
  vencimento: emDias(60),
  ...over,
});

describe('dias ate o vencimento', () => {
  it('conta por dia, nao por milissegundo', () => {
    // vence hoje as 23h; as 8h ainda e "hoje", nao "amanha"
    expect(diasAte(new Date('2026-08-10T23:00:00-03:00'), AGORA)).toBe(0);
  });

  it('vencimento de ontem da negativo', () => {
    expect(diasAte(new Date('2026-08-09T23:00:00-03:00'), AGORA)).toBe(-1);
  });

  it('madrugada do dia seguinte ainda e amanha', () => {
    expect(diasAte(new Date('2026-08-11T00:30:00-03:00'), AGORA)).toBe(1);
  });
});

describe('classificacao', () => {
  it('documento com 60 dias e regular', () => {
    const a = classificarDocumento(doc(), undefined, AGORA);
    expect(a.situacao).toBe('REGULAR');
    expect(a.semaforo).toBe('verde');
    expect(a.janela).toBeNull();
  });

  it('30 dias entra na janela de 30', () => {
    const a = classificarDocumento(doc({ vencimento: emDias(30) }), undefined, AGORA);
    expect(a.situacao).toBe('EM_ALERTA');
    expect(a.janela).toBe(30);
    expect(a.semaforo).toBe('ouro');
  });

  it('31 dias ainda e regular', () => {
    expect(classificarDocumento(doc({ vencimento: emDias(31) }), undefined, AGORA).situacao).toBe('REGULAR');
  });

  it('15 dias cai na janela de 15, nao na de 30', () => {
    expect(classificarDocumento(doc({ vencimento: emDias(15) }), undefined, AGORA).janela).toBe(15);
  });

  it('5 dias cai na janela de 7', () => {
    expect(classificarDocumento(doc({ vencimento: emDias(5) }), undefined, AGORA).janela).toBe(7);
  });

  it('vence hoje e vermelho', () => {
    const a = classificarDocumento(doc({ vencimento: emDias(0) }), undefined, AGORA);
    expect(a.situacao).toBe('VENCE_HOJE');
    expect(a.semaforo).toBe('vermelho');
    expect(a.mensagem).toContain('vence hoje');
  });

  it('vencido informa ha quantos dias', () => {
    const a = classificarDocumento(doc({ vencimento: emDias(-3) }), undefined, AGORA);
    expect(a.situacao).toBe('VENCIDO');
    expect(a.diasRestantes).toBe(-3);
    expect(a.mensagem).toContain('vencido ha 3');
  });

  it('aceita janelas customizadas', () => {
    expect(classificarDocumento(doc({ vencimento: emDias(45) }), [60], AGORA).janela).toBe(60);
  });
});

describe('painel de documentos', () => {
  const documentos = [
    doc({ id: 'a', vencimento: emDias(60) }),
    doc({ id: 'b', tipo: 'CNH', origem: 'motorista', origemId: 'm1', identificacao: 'Joao', vencimento: emDias(-5) }),
    doc({ id: 'c', tipo: 'Seguro', vencimento: emDias(10) }),
    doc({ id: 'd', tipo: 'ANTT', vencimento: emDias(0) }),
  ];

  it('ordena por urgencia', () => {
    const p = montarPainelDocumentos(documentos, undefined, AGORA);
    expect(p.alertas.map((a) => a.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('resume por situacao', () => {
    const p = montarPainelDocumentos(documentos, undefined, AGORA);
    expect([p.vencidos, p.venceHoje, p.emAlerta, p.regulares]).toEqual([1, 1, 1, 1]);
  });

  it('painel vazio nao quebra', () => {
    const p = montarPainelDocumentos([], undefined, AGORA);
    expect(p.alertas).toHaveLength(0);
    expect(p.vencidos).toBe(0);
  });
});

describe('impedimentos', () => {
  it('agrupa motivos por veiculo ou motorista', () => {
    const alertas = montarPainelDocumentos(
      [
        doc({ id: 'a', tipo: 'CRLV', origemId: 'v1', vencimento: emDias(-1) }),
        doc({ id: 'b', tipo: 'Seguro', origemId: 'v1', vencimento: emDias(-2) }),
        doc({ id: 'c', tipo: 'ANTT', origemId: 'v2', vencimento: emDias(30) }),
      ],
      undefined,
      AGORA,
    ).alertas;

    const r = impedimentos(alertas);
    expect(r).toHaveLength(1);
    expect(r[0]?.origemId).toBe('v1');
    expect(r[0]?.motivos).toHaveLength(2);
  });

  it('documento a vencer nao impede', () => {
    const alertas = montarPainelDocumentos([doc({ vencimento: emDias(1) })], undefined, AGORA).alertas;
    expect(impedimentos(alertas)).toHaveLength(0);
  });
});
