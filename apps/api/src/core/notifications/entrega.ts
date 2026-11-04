/**
 * Politica de entrega da fila de saida (F10). Modulo puro.
 *
 * O canal IN_APP ja nasce entregue: a notificacao E a linha no banco. E-mail e
 * WhatsApp dependem de terceiro, e terceiro falha - por isso tentativa, backoff
 * e desistencia explicita, em vez de "enviado" otimista.
 *
 * WhatsApp continua sendo canal de SAIDA apenas (secao 5.5): aqui so se despacha.
 */

export type Canal = 'IN_APP' | 'EMAIL' | 'WHATSAPP';

/** Depois disto, a notificacao e descartada e passa a exigir acao humana. */
export const MAX_TENTATIVAS = 5;

/** Backoff exponencial em minutos: 1, 2, 4, 8, 16. */
export function esperaEmMinutos(tentativas: number): number {
  if (tentativas < 0) throw new RangeError('O numero de tentativas nao pode ser negativo.');
  return 2 ** Math.min(tentativas, MAX_TENTATIVAS - 1);
}

export interface NotificacaoNaFila {
  id: string;
  canal: Canal;
  tentativas: number;
  enviadaEm: Date | null;
  descartadaEm: Date | null;
  proximaTentativaEm: Date | null;
}

/** Elegivel para despacho agora? */
export function elegivelParaEnvio(n: NotificacaoNaFila, agora = new Date()): boolean {
  if (n.enviadaEm || n.descartadaEm) return false;
  if (n.tentativas >= MAX_TENTATIVAS) return false;
  return n.proximaTentativaEm === null || n.proximaTentativaEm <= agora;
}

export type ResultadoEntrega =
  | { estado: 'ENTREGUE'; referenciaExterna?: string | null }
  | { estado: 'FALHOU'; erro: string; permanente?: boolean }
  | { estado: 'NAO_CONFIGURADO'; erro: string };

export interface DecisaoDeFila {
  enviadaEm: Date | null;
  tentativas: number;
  proximaTentativaEm: Date | null;
  ultimoErro: string | null;
  descartadaEm: Date | null;
  referenciaExterna: string | null;
}

/**
 * Traduz o resultado do adaptador no proximo estado da fila.
 *
 * Tres decisoes que valem registro:
 * - **erro permanente nao e reprocessado**: e-mail invalido nao melhora na quinta tentativa;
 * - **canal nao configurado nao consome tentativa**: a culpa e da infraestrutura, nao do destinatario,
 *   e quando alguem configurar o SMTP a fila inteira sai sem intervencao;
 * - **descartar e explicito**, com data e motivo, para aparecer no painel de falhas.
 */
export function proximoEstado(
  atual: NotificacaoNaFila,
  resultado: ResultadoEntrega,
  agora = new Date(),
): DecisaoDeFila {
  const base: DecisaoDeFila = {
    enviadaEm: null,
    tentativas: atual.tentativas,
    proximaTentativaEm: null,
    ultimoErro: null,
    descartadaEm: null,
    referenciaExterna: null,
  };

  if (resultado.estado === 'ENTREGUE') {
    return {
      ...base,
      enviadaEm: agora,
      tentativas: atual.tentativas + 1,
      referenciaExterna: resultado.referenciaExterna ?? null,
    };
  }

  if (resultado.estado === 'NAO_CONFIGURADO') {
    // nao consome tentativa: assim que o canal for configurado, a fila sai sozinha
    return {
      ...base,
      ultimoErro: resultado.erro,
      proximaTentativaEm: new Date(agora.getTime() + 60 * 60_000),
    };
  }

  const tentativas = atual.tentativas + 1;
  const desiste = resultado.permanente === true || tentativas >= MAX_TENTATIVAS;

  return {
    ...base,
    tentativas,
    ultimoErro: resultado.erro,
    descartadaEm: desiste ? agora : null,
    proximaTentativaEm: desiste ? null : new Date(agora.getTime() + esperaEmMinutos(tentativas) * 60_000),
  };
}

/** Endereco de e-mail plausivel. Validacao de forma, nao de existencia. */
export const emailPlausivel = (email: string | null | undefined): boolean =>
  typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

/**
 * Telefone brasileiro em E.164 para o WhatsApp: 55 + DDD + numero.
 * Devolve null quando nao da para montar com seguranca - mandar mensagem
 * para o numero errado e pior do que nao mandar.
 */
export function telefoneE164(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? '').replace(/\D/g, '');
  if (digitos.length === 0) return null;

  const semPais = digitos.startsWith('55') ? digitos.slice(2) : digitos;
  // DDD (2) + 8 ou 9 digitos
  if (semPais.length !== 10 && semPais.length !== 11) return null;

  const ddd = Number(semPais.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;

  return `55${semPais}`;
}
