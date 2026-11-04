-- Trilha de auditoria imutavel no nivel do banco (secao 5.4).
-- Idempotente: pode ser reaplicada sobre um banco que ja recebeu o script manual.
-- Sem BEGIN/COMMIT explicitos - o Prisma ja envolve cada migration em transacao.

CREATE OR REPLACE FUNCTION auditoria_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % e append-only. Registro nao pode ser alterado nem removido.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_append_only ON auditoria;
CREATE TRIGGER trg_auditoria_append_only
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_append_only();

-- `aprovacoes` passa a existir nesta fase (F1) e tambem e append-only.
DROP TRIGGER IF EXISTS trg_aprovacoes_append_only ON aprovacoes;
CREATE TRIGGER trg_aprovacoes_append_only
  BEFORE UPDATE OR DELETE ON aprovacoes
  FOR EACH ROW EXECUTE FUNCTION auditoria_append_only();

-- `lote_transicoes` e o historico da maquina de estados: reescrever apagaria o rastro
-- de quem moveu o lote e por que.
DROP TRIGGER IF EXISTS trg_lote_transicoes_append_only ON lote_transicoes;
CREATE TRIGGER trg_lote_transicoes_append_only
  BEFORE UPDATE OR DELETE ON lote_transicoes
  FOR EACH ROW EXECUTE FUNCTION auditoria_append_only();

-- `movimentacoes` (F4) e `checklist_fotos` (F6) recebem o mesmo gatilho nas suas fases.

DO $$
DECLARE
  app_role text := current_user;
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE auditoria FROM %I', app_role);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE aprovacoes FROM %I', app_role);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem privilegio para revogar. Rode como superusuario.';
END;
$$;

CREATE INDEX IF NOT EXISTS idx_auditoria_cadeia ON auditoria (timestamp ASC, id ASC);
