import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env.js';
import { emailPlausivel, telefoneE164, type Canal, type ResultadoEntrega } from './entrega.js';

/**
 * Adaptadores de saida (F10).
 *
 * Regra que vale para todos: **canal sem configuracao devolve `NAO_CONFIGURADO`,
 * nunca `ENTREGUE`**. Marcar como enviado o que nao saiu e o tipo de mentira que
 * so aparece quando alguem cobra "por que nao me avisaram?".
 */

export interface DestinatarioEntrega {
  nome: string;
  email: string | null;
  telefone: string | null;
}

export interface MensagemParaEnviar {
  titulo: string;
  corpo: string;
  entidade?: string | null;
  entidadeId?: string | null;
  /**
   * Documento que acompanha a mensagem, ja em link assinado. E o caso da ficha de
   * largada (secao 14.7): o motorista precisa do PDF no celular, e nao de um resumo
   * em texto do que estava no PDF.
   */
  documento?: { url: string; nome: string } | null;
}

export type Adaptador = (
  destinatario: DestinatarioEntrega,
  mensagem: MensagemParaEnviar,
) => Promise<ResultadoEntrega>;

// ---------------------------------------------------------------- e-mail

let transporte: Transporter | null = null;

const smtpConfigurado = (): boolean => Boolean(env.SMTP_HOST);

function transporteSmtp(): Transporter {
  transporte ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SEGURO,
    auth: env.SMTP_USUARIO ? { user: env.SMTP_USUARIO, pass: env.SMTP_SENHA } : undefined,
  });
  return transporte;
}

/** Erros de SMTP na faixa 5xx sao definitivos: reenviar nao muda o resultado. */
const ehPermanente = (erro: unknown): boolean => {
  const codigo = (erro as { responseCode?: number })?.responseCode;
  return typeof codigo === 'number' && codigo >= 500 && codigo < 600;
};

export const enviarEmail: Adaptador = async (destinatario, mensagem) => {
  if (!smtpConfigurado()) {
    return { estado: 'NAO_CONFIGURADO', erro: 'SMTP nao configurado (SMTP_HOST ausente).' };
  }
  if (!emailPlausivel(destinatario.email)) {
    return { estado: 'FALHOU', erro: 'Usuario sem e-mail valido cadastrado.', permanente: true };
  }

  try {
    const envio = await transporteSmtp().sendMail({
      from: env.SMTP_REMETENTE,
      to: `${destinatario.nome} <${destinatario.email}>`,
      subject: mensagem.titulo,
      // o adaptador nao carrega binario: o documento vai como link assinado no corpo
      text: [
        mensagem.corpo,
        mensagem.documento ? `\n\nDocumento: ${mensagem.documento.nome}\n${mensagem.documento.url}` : '',
        '\n\n--\nSGI Ceara - Ceara Alimentos\nMensagem automatica; nao responda.',
      ].join(''),
    });

    return { estado: 'ENTREGUE', referenciaExterna: envio.messageId ?? null };
  } catch (erro) {
    return {
      estado: 'FALHOU',
      erro: erro instanceof Error ? erro.message : 'Falha no envio por e-mail.',
      permanente: ehPermanente(erro),
    };
  }
};

// ---------------------------------------------------------------- WhatsApp

/**
 * WhatsApp e canal de SAIDA apenas (secao 5.5) - foi o canal duplo que o POP
 * apontou como fragilidade. Este adaptador so despacha; nada entra por aqui.
 */
export const enviarWhatsapp: Adaptador = async (destinatario, mensagem) => {
  if (!env.WHATSAPP_URL || !env.WHATSAPP_TOKEN) {
    return { estado: 'NAO_CONFIGURADO', erro: 'WhatsApp nao configurado (WHATSAPP_URL/WHATSAPP_TOKEN ausentes).' };
  }

  const numero = telefoneE164(destinatario.telefone);
  if (!numero) {
    return { estado: 'FALHOU', erro: 'Usuario sem telefone valido cadastrado.', permanente: true };
  }

  try {
    const resposta = await fetch(env.WHATSAPP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        para: numero,
        texto: `*${mensagem.titulo}*\n\n${mensagem.corpo}`,
        // o provedor busca o arquivo pelo link e entrega como documento no chat;
        // mandar so o link deixaria a ficha a um toque de distancia de ser ignorada
        documento: mensagem.documento
          ? { url: mensagem.documento.url, nome: mensagem.documento.nome, tipo: 'application/pdf' }
          : null,
        referencia: mensagem.entidadeId ?? null,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      return {
        estado: 'FALHOU',
        erro: `Provedor respondeu ${resposta.status}. ${corpo.slice(0, 200)}`.trim(),
        // 4xx e pedido malformado ou numero invalido: repetir nao resolve
        permanente: resposta.status >= 400 && resposta.status < 500 && resposta.status !== 429,
      };
    }

    const dados = (await resposta.json().catch(() => null)) as { id?: string } | null;
    return { estado: 'ENTREGUE', referenciaExterna: dados?.id ?? null };
  } catch (erro) {
    return { estado: 'FALHOU', erro: erro instanceof Error ? erro.message : 'Falha no envio por WhatsApp.' };
  }
};

// ---------------------------------------------------------------- in-app

/** IN_APP ja esta entregue quando a linha existe: a caixa de entrada e o proprio banco. */
export const entregarInApp: Adaptador = async () => ({ estado: 'ENTREGUE' });

export const ADAPTADORES: Record<Canal, Adaptador> = {
  IN_APP: entregarInApp,
  EMAIL: enviarEmail,
  WHATSAPP: enviarWhatsapp,
};

/** Quais canais estao prontos para uso - vai para o /health e para a tela de falhas. */
export const canaisConfigurados = (): Record<Canal, boolean> => ({
  IN_APP: true,
  EMAIL: smtpConfigurado(),
  WHATSAPP: Boolean(env.WHATSAPP_URL && env.WHATSAPP_TOKEN),
});
