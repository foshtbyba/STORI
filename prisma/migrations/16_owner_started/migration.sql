-- Дата выхода овнеров SKO и MPR — 16 августа. Для овнеров это справочно
-- (в зарплате они не участвуют), но пусть стоит.
UPDATE "Buyer" SET "startedAt" = TIMESTAMP '2026-08-16 00:00:00' WHERE "handle" IN ('SKO', 'MPR');
