import { describe, expect, it } from 'vitest';
import {
  avaliarEntrada,
  avaliarPermanencia,
  avaliarSaida,
  kmDaViagem,
  normalizarDocumento,
  normalizarPlaca,
  permanenciaEmMinutos,
  podeEntrar,
  type ContextoEntrada,
} from './regras.js';

const AGORA = new Date('2026-08-05T13:00:00Z');

const entrada = (over: Partial<ContextoEntrada> = {}): ContextoEntrada => ({
  tipo: 'PESSOA',
  pessoa: { nome: 'Joana Alves', documento: '12345678900', bloqueado: false },
  jaTemAcessoAberto: false,
  motivo: 'entrega de documentos',
  aoVolante: false,
  agora: AGORA,
  ...over,
});

const codigos = (ctx: ContextoEntrada) => avaliarEntrada(ctx).map((i) => i.codigo);

describe('avaliacao da entrada', () => {
  it('visitante identificado e com motivo entra', () => {
    expect(podeEntrar(entrada())).toBe(true);
  });

  it('lista restritiva barra, e a guarita nao pode liberar', () => {
    const ctx = entrada({
      pessoa: { nome: 'Joana Alves', documento: '12345678900', bloqueado: true, motivoBloqueio: 'furto em 2025' },
    });
    const impedimento = avaliarEntrada(ctx).find((i) => i.codigo === 'PESSOA_BLOQUEADA');
    expect(impedimento).toBeDefined();
    expect(impedimento!.liberavel).toBe(false);
    expect(impedimento!.mensagem).toContain('furto em 2025');
  });

  it('entrada sem motivo nao passa', () => {
    expect(codigos(entrada({ motivo: '  ' }))).toContain('SEM_MOTIVO');
  });

  it('pessoa sem documento nao passa', () => {
    expect(codigos(entrada({ pessoa: { nome: 'Sem nome', documento: '', bloqueado: false } }))).toContain(
      'SEM_DOCUMENTO',
    );
  });

  it('acesso anterior em aberto impede abrir outro', () => {
    expect(codigos(entrada({ jaTemAcessoAberto: true }))).toContain('JA_ESTA_DENTRO');
  });

  it('CNH vencida barra quem vai dirigir, e a liberacao e registravel', () => {
    const ctx = entrada({
      aoVolante: true,
      pessoa: {
        nome: 'Motorista Terceiro',
        documento: '98765432100',
        bloqueado: false,
        cnhVencimento: new Date('2026-01-31T00:00:00Z'),
      },
    });
    const impedimento = avaliarEntrada(ctx).find((i) => i.codigo === 'CNH_VENCIDA');
    expect(impedimento?.liberavel).toBe(true);
  });

  it('CNH vencida nao importa para quem entra a pe', () => {
    const ctx = entrada({
      aoVolante: false,
      pessoa: {
        nome: 'Motorista Terceiro',
        documento: '98765432100',
        bloqueado: false,
        cnhVencimento: new Date('2026-01-31T00:00:00Z'),
      },
    });
    expect(codigos(ctx)).not.toContain('CNH_VENCIDA');
  });

  it('CNH no prazo nao gera impedimento', () => {
    const ctx = entrada({
      aoVolante: true,
      pessoa: {
        nome: 'Motorista Terceiro',
        documento: '98765432100',
        bloqueado: false,
        cnhVencimento: new Date('2027-01-31T00:00:00Z'),
      },
    });
    expect(codigos(ctx)).toEqual([]);
  });

  it('caminhao proprio saindo nao depende de cadastro de pessoa externa', () => {
    expect(podeEntrar(entrada({ tipo: 'VEICULO_PROPRIO', pessoa: null, motivo: 'coleta na rota 3' }))).toBe(true);
  });
});

describe('avaliacao da saida', () => {
  const abertoEm = new Date('2026-08-05T09:00:00Z');

  it('saida limpa nao tem pendencia', () => {
    expect(avaliarSaida({ tipo: 'PESSOA', crachaDevolvido: true, cracha: 'V-12', abertoEm })).toEqual([]);
  });

  it('cracha entregue e nao devolvido trava a saida', () => {
    const p = avaliarSaida({ tipo: 'PESSOA', cracha: 'V-12', crachaDevolvido: false, abertoEm });
    expect(p.map((x) => x.codigo)).toEqual(['CRACHA_NAO_DEVOLVIDO']);
    expect(p[0]!.mensagem).toContain('V-12');
  });

  it('sem cracha entregue nao ha o que cobrar', () => {
    expect(avaliarSaida({ tipo: 'PESSOA', cracha: null, crachaDevolvido: false, abertoEm })).toEqual([]);
  });

  it('acesso sem evento de abertura nao tem saida a registrar', () => {
    expect(
      avaliarSaida({ tipo: 'PESSOA', crachaDevolvido: true, abertoEm: null }).map((x) => x.codigo),
    ).toContain('SEM_ENTRADA');
  });

  it('hodometro de retorno menor que o de saida acusa leitura errada', () => {
    const p = avaliarSaida({
      tipo: 'VEICULO_PROPRIO',
      crachaDevolvido: true,
      hodometroSaida: '150000',
      hodometroRetorno: '149000',
      abertoEm,
    });
    expect(p.map((x) => x.codigo)).toEqual(['HODOMETRO_MENOR']);
  });

  it('hodometro so e conferido no caminhao da casa', () => {
    expect(
      avaliarSaida({
        tipo: 'VEICULO_EXTERNO',
        crachaDevolvido: true,
        hodometroSaida: '150000',
        hodometroRetorno: '149000',
        abertoEm,
      }),
    ).toEqual([]);
  });
});

describe('km da viagem', () => {
  it('apura a diferenca das leituras', () => {
    expect(kmDaViagem('150000', '150432.5')?.toFixed(1)).toBe('432.5');
  });

  it('sem uma das leituras nao inventa numero', () => {
    expect(kmDaViagem(null, '150432')).toBeNull();
    expect(kmDaViagem('150000', undefined)).toBeNull();
  });

  it('diferenca negativa nao vira km', () => {
    expect(kmDaViagem('150000', '149000')).toBeNull();
  });
});

describe('permanencia', () => {
  it('conta do evento de abertura ate agora quando ainda esta aberto', () => {
    expect(permanenciaEmMinutos(new Date('2026-08-05T09:30:00Z'), null, AGORA)).toBe(210);
  });

  it('usa o fechamento quando ele existe', () => {
    expect(
      permanenciaEmMinutos(new Date('2026-08-05T09:00:00Z'), new Date('2026-08-05T10:15:00Z'), AGORA),
    ).toBe(75);
  });

  it('sem abertura nao ha permanencia', () => {
    expect(permanenciaEmMinutos(null, null, AGORA)).toBeNull();
  });

  it.each([
    [60, 'NORMAL'],
    [480, 'ATENCAO'],
    [600, 'EXCEDIDA'],
  ] as Array<[number, string]>)('%i minutos com limite de 10h fica %s', (minutos, estado) => {
    expect(avaliarPermanencia(minutos, 10).estado).toBe(estado);
  });

  it('sem limite parametrizado nao alerta', () => {
    expect(avaliarPermanencia(5000, 0).estado).toBe('NORMAL');
  });
});

describe('normalizacao', () => {
  it.each([
    ['abc-1234', 'ABC1234'],
    ['ABC1D23', 'ABC1D23'],
    [' abc1d23 ', 'ABC1D23'],
  ])('placa %s vira %s', (bruta, esperada) => {
    expect(normalizarPlaca(bruta)).toBe(esperada);
  });

  it('placa fora do padrao e recusada', () => {
    expect(() => normalizarPlaca('AB-123')).toThrow(RangeError);
  });

  it('documento perde pontuacao para o mesmo CPF nao virar dois cadastros', () => {
    expect(normalizarDocumento('123.456.789-00')).toBe('12345678900');
  });
});
