import { describe, expect, it } from 'vitest';
import {
  elegivelParaEnvio,
  emailPlausivel,
  esperaEmMinutos,
  MAX_TENTATIVAS,
  proximoEstado,
  telefoneE164,
  type NotificacaoNaFila,
} from './entrega.js';

const agora = new Date('2026-08-03T12:00:00Z');

const naFila = (over: Partial<NotificacaoNaFila> = {}): NotificacaoNaFila => ({
  id: 'n1',
  canal: 'EMAIL',
  tentativas: 0,
  enviadaEm: null,
  descartadaEm: null,
  proximaTentativaEm: null,
  ...over,
});

describe('elegibilidade', () => {
  it('pega o que nunca foi tentado', () => {
    expect(elegivelParaEnvio(naFila(), agora)).toBe(true);
  });

  it('ignora o que ja foi entregue ou descartado', () => {
    expect(elegivelParaEnvio(naFila({ enviadaEm: agora }), agora)).toBe(false);
    expect(elegivelParaEnvio(naFila({ descartadaEm: agora }), agora)).toBe(false);
  });

  it('respeita o backoff', () => {
    const daqui5min = new Date(agora.getTime() + 5 * 60_000);
    expect(elegivelParaEnvio(naFila({ proximaTentativaEm: daqui5min }), agora)).toBe(false);
    expect(elegivelParaEnvio(naFila({ proximaTentativaEm: agora }), agora)).toBe(true);
  });

  it('nao insiste depois do limite de tentativas', () => {
    expect(elegivelParaEnvio(naFila({ tentativas: MAX_TENTATIVAS }), agora)).toBe(false);
  });
});

describe('backoff exponencial', () => {
  it('dobra a espera a cada tentativa', () => {
    expect([0, 1, 2, 3, 4].map(esperaEmMinutos)).toEqual([1, 2, 4, 8, 16]);
  });

  it('nao cresce indefinidamente', () => {
    expect(esperaEmMinutos(99)).toBe(esperaEmMinutos(MAX_TENTATIVAS - 1));
  });

  it('recusa numero negativo', () => {
    expect(() => esperaEmMinutos(-1)).toThrow(RangeError);
  });
});

describe('proximo estado da fila', () => {
  it('entrega marca a data e guarda a referencia do provedor', () => {
    const d = proximoEstado(naFila(), { estado: 'ENTREGUE', referenciaExterna: 'msg-123' }, agora);
    expect(d.enviadaEm).toEqual(agora);
    expect(d.referenciaExterna).toBe('msg-123');
    expect(d.descartadaEm).toBeNull();
  });

  it('falha temporaria reagenda com backoff e guarda o erro', () => {
    const d = proximoEstado(naFila({ tentativas: 1 }), { estado: 'FALHOU', erro: 'timeout do SMTP' }, agora);
    expect(d.tentativas).toBe(2);
    expect(d.ultimoErro).toBe('timeout do SMTP');
    expect(d.proximaTentativaEm).toEqual(new Date(agora.getTime() + 4 * 60_000));
    expect(d.descartadaEm).toBeNull();
  });

  it('erro permanente nao volta para a fila', () => {
    const d = proximoEstado(naFila(), { estado: 'FALHOU', erro: 'endereco inexistente', permanente: true }, agora);
    expect(d.descartadaEm).toEqual(agora);
    expect(d.proximaTentativaEm).toBeNull();
  });

  it('descarta ao esgotar as tentativas, com data e motivo', () => {
    const d = proximoEstado(naFila({ tentativas: MAX_TENTATIVAS - 1 }), { estado: 'FALHOU', erro: 'recusado' }, agora);
    expect(d.tentativas).toBe(MAX_TENTATIVAS);
    expect(d.descartadaEm).toEqual(agora);
    expect(d.ultimoErro).toBe('recusado');
  });

  it('canal nao configurado nao consome tentativa', () => {
    const d = proximoEstado(naFila({ tentativas: 3 }), { estado: 'NAO_CONFIGURADO', erro: 'SMTP ausente' }, agora);
    // a culpa e da infraestrutura: quando alguem configurar, a fila sai sozinha
    expect(d.tentativas).toBe(3);
    expect(d.descartadaEm).toBeNull();
    expect(d.proximaTentativaEm).toEqual(new Date(agora.getTime() + 3_600_000));
  });
});

describe('destinatarios', () => {
  it('reconhece e-mail plausivel', () => {
    expect(emailPlausivel('alan@cearaalimentos.com.br')).toBe(true);
    expect(emailPlausivel('alan@local')).toBe(false);
    expect(emailPlausivel(null)).toBe(false);
  });

  it('monta o telefone em E.164 com DDD', () => {
    expect(telefoneE164('(98) 98888-7777')).toBe('5598988887777');
    expect(telefoneE164('98 3222-1111')).toBe('559832221111');
    expect(telefoneE164('+55 98 98888-7777')).toBe('5598988887777');
  });

  it('devolve null quando nao da para montar com seguranca', () => {
    expect(telefoneE164('1234')).toBeNull();
    expect(telefoneE164('(01) 98888-7777')).toBeNull();
    expect(telefoneE164(null)).toBeNull();
  });
});
