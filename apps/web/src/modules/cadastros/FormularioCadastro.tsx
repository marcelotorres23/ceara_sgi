import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { Campo, classeControle } from '../../design-system/components/Campo';
import { Button } from '../../design-system/components/Button';
import { cn } from '../../design-system/cn';
import type { CampoFormulario } from './tipos';

interface Props {
  campos: CampoFormulario[];
  enviando: boolean;
  erroServidor: string | null;
  onCancelar: () => void;
  onEnviar: (valores: Record<string, string | boolean>) => void;
  /** preenche o formulario para edicao; ausente = criacao */
  registro?: Record<string, unknown> | null;
  /** campos bloqueados na edicao */
  naoEditaveis?: string[];
}

/** Data vinda da API (ISO) para o formato que o input[type=date] espera. */
const paraCampoData = (valor: unknown): string =>
  typeof valor === 'string' && valor.length >= 10 ? valor.slice(0, 10) : '';

function valoresIniciais(
  campos: CampoFormulario[],
  registro?: Record<string, unknown> | null,
): Record<string, string | boolean> {
  return Object.fromEntries(
    campos.map((c) => {
      if (!registro) return [c.nome, c.tipo === 'booleano' ? false : (c.padrao ?? '')];

      const bruto = registro[c.nome];
      if (c.tipo === 'booleano') return [c.nome, Boolean(bruto)];
      if (c.tipo === 'data') return [c.nome, paraCampoData(bruto)];
      return [c.nome, bruto == null ? '' : String(bruto)];
    }),
  );
}

export function FormularioCadastro({
  campos, enviando, erroServidor, onCancelar, onEnviar, registro, naoEditaveis,
}: Props) {
  const [valores, setValores] = useState(() => valoresIniciais(campos, registro));
  const [erros, setErros] = useState<Record<string, string>>({});
  const [tocado, setTocado] = useState<Record<string, boolean>>({});

  useEffect(() => setValores(valoresIniciais(campos, registro)), [campos, registro]);

  function validarCampo(campo: CampoFormulario, valor: string | boolean): string | null {
    if (campo.tipo === 'booleano') return null;
    const texto = String(valor).trim();

    if (campo.obrigatorio && texto === '') return 'Campo obrigatorio.';
    if (texto === '') return null;
    return campo.validar?.(texto) ?? null;
  }

  function aoMudar(campo: CampoFormulario, valor: string | boolean) {
    setValores((v) => ({ ...v, [campo.nome]: valor }));
    if (tocado[campo.nome]) {
      const erro = validarCampo(campo, valor);
      setErros((e) => ({ ...e, [campo.nome]: erro ?? '' }));
    }
  }

  function aoSair(campo: CampoFormulario) {
    setTocado((t) => ({ ...t, [campo.nome]: true }));
    const erro = validarCampo(campo, valores[campo.nome] ?? '');
    setErros((e) => ({ ...e, [campo.nome]: erro ?? '' }));
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();

    const novosErros: Record<string, string> = {};
    for (const campo of campos) {
      const erro = validarCampo(campo, valores[campo.nome] ?? '');
      if (erro) novosErros[campo.nome] = erro;
    }

    setErros(novosErros);
    setTocado(Object.fromEntries(campos.map((c) => [c.nome, true])));

    if (Object.keys(novosErros).length > 0) return;

    const prontos = Object.fromEntries(
      campos.map((c) => {
        const bruto = valores[c.nome];
        if (c.tipo === 'booleano') return [c.nome, Boolean(bruto)];
        const texto = String(bruto).trim();
        return [c.nome, c.transformar ? c.transformar(texto) : texto];
      }),
    );

    onEnviar(prontos);
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {campos.map((campo) => (
          <ControleDoCampo
            key={campo.nome}
            campo={campo}
            valor={valores[campo.nome] ?? ''}
            erro={erros[campo.nome] || null}
            bloqueado={Boolean(registro) && (naoEditaveis ?? []).includes(campo.nome)}
            onMudar={(v) => aoMudar(campo, v)}
            onSair={() => aoSair(campo)}
          />
        ))}
      </div>

      {erroServidor && (
        <p role="alert" className="rounded-lg border-l-4 border-ceara-vermelho bg-[rgba(192,57,43,0.08)] px-3 py-2 text-corpo text-ceara-vermelho">
          {erroServidor}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-ceara-borda pt-3">
        <Button variante="texto" type="button" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit" carregando={enviando}>Salvar</Button>
      </div>
    </form>
  );
}

function ControleDoCampo({
  campo, valor, erro, bloqueado, onMudar, onSair,
}: {
  campo: CampoFormulario;
  valor: string | boolean;
  erro: string | null;
  bloqueado?: boolean;
  onMudar: (v: string | boolean) => void;
  onSair: () => void;
}) {
  const id = `campo-${campo.nome}`;
  const largura = campo.largura === 'inteira' ? 'sm:col-span-2' : undefined;
  const ajuda = bloqueado ? 'Este campo nao pode ser alterado depois do cadastro.' : (campo.ajuda ?? null);

  if (campo.tipo === 'booleano') {
    return (
      <label className={cn('flex items-center gap-2 text-corpo', largura, bloqueado && 'opacity-60')}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(valor)}
          disabled={bloqueado}
          onChange={(e) => onMudar(e.target.checked)}
        />
        {campo.rotulo}
      </label>
    );
  }

  if (campo.tipo === 'referencia') {
    return (
      <SelecaoDeReferencia
        campo={campo}
        id={id}
        valor={String(valor)}
        erro={erro}
        largura={largura}
        bloqueado={bloqueado}
        onMudar={onMudar}
        onSair={onSair}
      />
    );
  }

  return (
    <Campo
      rotulo={campo.rotulo}
      erro={erro}
      ajuda={ajuda}
      obrigatorio={campo.obrigatorio}
      htmlFor={id}
      className={largura}
    >
      {campo.tipo === 'selecao' ? (
        <select
          id={id}
          value={String(valor)}
          disabled={bloqueado}
          onChange={(e) => onMudar(e.target.value)}
          onBlur={onSair}
          className={cn(classeControle(Boolean(erro)), bloqueado && 'bg-ceara-nevoa text-ceara-texto2')}
        >
          <option value="">Selecione</option>
          {(campo.opcoes ?? []).map((o) => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={campo.tipo === 'data' ? 'date' : 'text'}
          inputMode={campo.tipo === 'numero' ? 'decimal' : undefined}
          value={String(valor)}
          disabled={bloqueado}
          placeholder={campo.placeholder}
          onChange={(e) => onMudar(e.target.value)}
          onBlur={onSair}
          aria-invalid={Boolean(erro)}
          className={cn(classeControle(Boolean(erro)), bloqueado && 'bg-ceara-nevoa text-ceara-texto2')}
        />
      )}
    </Campo>
  );
}

/** Campo que busca as opcoes de outro recurso, ex.: centro de custo, veiculo padrao. */
function SelecaoDeReferencia({
  campo, id, valor, erro, largura, bloqueado, onMudar, onSair,
}: {
  campo: CampoFormulario;
  id: string;
  valor: string;
  erro: string | null;
  largura?: string;
  bloqueado?: boolean;
  onMudar: (v: string) => void;
  onSair: () => void;
}) {
  const referencia = campo.referencia!;

  const { data, isError } = useQuery({
    queryKey: ['referencia', referencia.recurso],
    queryFn: () => get<{ itens: Array<Record<string, unknown>> }>(referencia.recurso),
    staleTime: 300_000,
  });

  const opcoes = (data?.itens ?? []).map((i) => ({
    valor: String(i[referencia.valorCampo ?? 'id'] ?? ''),
    rotulo: String(i[referencia.rotuloCampo] ?? ''),
  }));

  return (
    <Campo
      rotulo={campo.rotulo}
      erro={erro}
      ajuda={isError ? 'Nao foi possivel carregar as opcoes.' : (campo.ajuda ?? null)}
      obrigatorio={campo.obrigatorio}
      htmlFor={id}
      className={largura}
    >
      <select
        id={id}
        value={valor}
        disabled={bloqueado}
        onChange={(e) => onMudar(e.target.value)}
        onBlur={onSair}
        className={cn(classeControle(Boolean(erro)), bloqueado && 'bg-ceara-nevoa text-ceara-texto2')}
      >
        <option value="">{data ? 'Selecione' : 'Carregando...'}</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.rotulo}</option>
        ))}
      </select>
    </Campo>
  );
}
