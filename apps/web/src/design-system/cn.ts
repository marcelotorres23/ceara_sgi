/** Concatena classes ignorando valores falsy. Sem dependencia externa. */
export const cn = (...partes: Array<string | false | null | undefined>): string =>
  partes.filter(Boolean).join(' ');
