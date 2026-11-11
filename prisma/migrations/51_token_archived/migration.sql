-- Отвязка токена теперь архивирует его, а не удаляет: кабинеты и FbAdDay
-- сохраняются, чтобы исторический расход (строка «Агентка») не переписывался
-- задним числом меньшим значением.
ALTER TABLE "AdToken" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;
