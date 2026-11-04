-- Ficha de largada (secao 14.7): a saida do caminhao para a rota vira documento em PDF,
-- e o documento chega no WhatsApp do motorista.

-- 1) O telefone do motorista e o endereco de entrega da ficha. Ate aqui o cadastro
--    guardava CNH e exames, mas nao guardava como falar com quem dirige.
ALTER TABLE "motoristas"
  ADD COLUMN "telefone" TEXT;

-- 2) Fila de saida para destinatario sem login. `notificacoes` exige `usuario_id`
--    porque tem caixa de entrada dentro do sistema; o motorista nao tem uma.
CREATE TABLE "mensagens_externas" (
  "id"                     TEXT NOT NULL,
  "canal"                  "CanalNotificacao" NOT NULL DEFAULT 'WHATSAPP',
  "titulo"                 TEXT NOT NULL,
  "corpo"                  TEXT NOT NULL,
  "destinatario_nome"      TEXT NOT NULL,
  "destinatario_telefone"  TEXT,
  "destinatario_email"     TEXT,
  "entidade"               TEXT,
  "entidade_id"            TEXT,
  "anexo_id"               TEXT,
  "tentativas"             INTEGER NOT NULL DEFAULT 0,
  "enviada_em"             TIMESTAMPTZ(3),
  "proxima_tentativa_em"   TIMESTAMPTZ(3),
  "ultimo_erro"            TEXT,
  "descartada_em"          TIMESTAMPTZ(3),
  "referencia_externa"     TEXT,
  "created_at"             TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"             TEXT,
  CONSTRAINT "mensagens_externas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mensagens_externas_entidade_idx"
  ON "mensagens_externas" ("entidade", "entidade_id");

-- o job de despacho varre por aqui: pendente, nao descartada e com a hora ja vencida
CREATE INDEX "mensagens_externas_fila_idx"
  ON "mensagens_externas" ("enviada_em", "descartada_em", "proxima_tentativa_em");

-- 3) O envio automatico nasce desligado: a guarita decide quando a ficha sai.
INSERT INTO "parametros" ("id", "chave", "valor", "descricao", "created_at", "updated_at")
VALUES (
  'param-portaria-ficha-largada-whatsapp',
  'portaria.enviar_ficha_largada_whatsapp',
  'false'::jsonb,
  'Envia a ficha de largada ao WhatsApp do motorista assim que a saida do caminhao e registrada. Desligado, a ficha so sai pelo botao da guarita.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("chave") DO NOTHING;
