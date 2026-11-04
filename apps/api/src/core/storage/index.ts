import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env.js';
import { ValidationError } from '../errors/index.js';

/**
 * Storage S3-compatible: MinIO em dev, R2 em producao (secao 2).
 * Foto nunca em base64 no banco - so a URL e o hash ficam persistidos.
 */

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

/** Foto de checklist: so imagem, porque leva marca d'agua. */
export const MIMES_IMAGEM = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Evidencia de cotacao: alem de imagem, PDF - orcamento de fornecedor chega em PDF
 * com a mesma frequencia com que chega em print de tela.
 */
export const MIMES_EVIDENCIA = new Set([...MIMES_IMAGEM, 'application/pdf']);

const TAMANHO_MAXIMO = 8 * 1024 * 1024;

export interface ArquivoParaSubir {
  conteudo: Buffer;
  mime: string;
  /** prefixo logico, ex.: 'checklists/2026/08' */
  pasta: string;
  nome: string;
  /** formatos aceitos; por padrao apenas imagem */
  mimesAceitos?: Set<string>;
}

export interface ArquivoSalvo {
  chave: string;
  url: string;
  hashSha256: string;
  tamanho: number;
}

export async function garantirBucket(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return true;
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
      return true;
    } catch {
      return false;
    }
  }
}

export async function salvarArquivo(arquivo: ArquivoParaSubir): Promise<ArquivoSalvo> {
  const aceitos = arquivo.mimesAceitos ?? MIMES_IMAGEM;
  if (!aceitos.has(arquivo.mime)) {
    const lista = [...aceitos].map((m) => m.split('/')[1]?.toUpperCase()).join(', ');
    throw new ValidationError(`Formato ${arquivo.mime} nao aceito. Envie ${lista}.`);
  }
  if (arquivo.conteudo.length === 0) throw new ValidationError('Arquivo vazio.');
  if (arquivo.conteudo.length > TAMANHO_MAXIMO) {
    throw new ValidationError(`Arquivo acima de ${TAMANHO_MAXIMO / 1024 / 1024} MB.`);
  }

  const hashSha256 = createHash('sha256').update(arquivo.conteudo).digest('hex');
  // o hash no nome deduplica reenvio da fila offline: mesma foto, mesma chave
  const chave = `${arquivo.pasta}/${hashSha256.slice(0, 16)}-${arquivo.nome}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: chave,
      Body: arquivo.conteudo,
      ContentType: arquivo.mime,
      ChecksumSHA256: undefined,
      Metadata: { sha256: hashSha256 },
    }),
  );

  return {
    chave,
    url: `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${chave}`,
    hashSha256,
    tamanho: arquivo.conteudo.length,
  };
}

/** URL assinada para leitura temporaria; o bucket nao precisa ser publico. */
export async function urlAssinada(chave: string, segundos = 3600): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: chave }), { expiresIn: segundos });
}

export async function storageDisponivel(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return true;
  } catch {
    return false;
  }
}
