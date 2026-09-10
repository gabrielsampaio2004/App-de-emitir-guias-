-- Um Consent GRANTED não pode ter revokedAt preenchido ao mesmo tempo.
--
-- O dispatcher decide se pode enviar filtrando só por `status`. Com os dois
-- campos livres, uma linha GRANTED com revokedAt preenchido passava na
-- checagem e a mensagem seria enviada para quem já tinha revogado — num
-- produto cuja razão de existir é provar consentimento LGPD.
--
-- `status` é a fonte de verdade única; `revokedAt` é só o carimbo de quando
-- a revogação aconteceu. A constraint proíbe a combinação incoerente no
-- banco, e não só na aplicação, na mesma linha das outras travas do projeto.
ALTER TABLE "Consent"
  ADD CONSTRAINT "Consent_granted_sem_revogacao"
  CHECK ("status" = 'REVOKED' OR "revokedAt" IS NULL);
