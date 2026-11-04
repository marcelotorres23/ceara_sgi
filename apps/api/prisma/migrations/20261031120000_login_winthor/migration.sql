-- Login pelo WinThor: a senha e conferida no Oracle (PCEMPR), o acesso continua no SGI.
-- O vinculo e o nome de guerra, gravado em maiusculas; sem vinculo, o WinThor nao abre o SGI.
ALTER TABLE "usuarios"
  ADD COLUMN "login_winthor" TEXT;

CREATE UNIQUE INDEX "usuarios_login_winthor_key" ON "usuarios"("login_winthor");
