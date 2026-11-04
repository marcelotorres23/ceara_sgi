const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

export interface ErroApi {
  codigo: string;
  mensagem: string;
  detalhe?: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly erro: ErroApi,
  ) {
    super(erro.mensagem);
    this.name = 'ApiError';
  }
}

let renovando: Promise<boolean> | null = null;

/** Uma unica renovacao concorrente: varias 401 simultaneas nao disparam N refresh. */
async function renovarSessao(): Promise<boolean> {
  renovando ??= fetch(`${BASE}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .finally(() => {
      renovando = null;
    });
  return renovando;
}

export async function api<T>(caminho: string, init: RequestInit = {}, tentarRenovar = true): Promise<T> {
  const resposta = await fetch(`${BASE}/api/v1${caminho}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (resposta.status === 401 && tentarRenovar && !caminho.startsWith('/auth/')) {
    if (await renovarSessao()) return api<T>(caminho, init, false);
  }

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: ErroApi } | null;
    throw new ApiError(
      resposta.status,
      corpo?.erro ?? { codigo: 'NETWORK_ERROR', mensagem: 'Falha de comunicacao com o servidor.' },
    );
  }

  if (resposta.status === 204) return undefined as T;
  return (await resposta.json()) as T;
}

export const get = <T>(caminho: string) => api<T>(caminho);
export const post = <T>(caminho: string, corpo?: unknown) =>
  api<T>(caminho, { method: 'POST', body: corpo === undefined ? undefined : JSON.stringify(corpo) });

/** Edicao parcial (governanca: usuario, perfil, parametro). */
export const patch = <T>(caminho: string, corpo: unknown) =>
  api<T>(caminho, { method: 'PATCH', body: JSON.stringify(corpo) });

/** Substituicao integral - usado pela matriz de alcadas, que so vale como conjunto. */
export const put = <T>(caminho: string, corpo: unknown) =>
  api<T>(caminho, { method: 'PUT', body: JSON.stringify(corpo) });

/**
 * Baixa um arquivo gerado pela API (XLSX dos relatorios).
 *
 * Nao usa `api()` porque a resposta e binaria, e nao JSON. O nome do arquivo vem
 * do `Content-Disposition`: quem decide como o arquivo se chama e o servidor,
 * que sabe o recorte usado.
 */
export async function baixarArquivo(caminho: string, nomePadrao: string): Promise<void> {
  const resposta = await fetch(`${BASE}/api/v1${caminho}`, { credentials: 'include' });

  if (resposta.status === 401 && (await renovarSessao())) {
    return baixarArquivo(caminho, nomePadrao);
  }

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: ErroApi } | null;
    throw new ApiError(
      resposta.status,
      corpo?.erro ?? { codigo: 'EXPORT_ERROR', mensagem: 'Nao foi possivel gerar o arquivo.' },
    );
  }

  const nome =
    /filename="([^"]+)"/.exec(resposta.headers.get('content-disposition') ?? '')?.[1] ?? nomePadrao;

  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}
