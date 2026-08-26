#!/usr/bin/env bash
# Разворачивает приложение на чистом сервере. Запускать от root:
#
#   bash scripts/bootstrap.sh                     # домен возьмёт из внешнего IP
#   bash scripts/bootstrap.sh ms.team             # или свой домен
#
# Повторный запуск безопасен: существующий .env не перезаписывается, секреты
# не перегенерируются — иначе все разлогинились бы, а база перестала пускать.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$(id -u)" -ne 0 ]; then
  echo "Запусти от root: sudo bash scripts/bootstrap.sh" >&2
  exit 1
fi

# apt печатает мало и медленно, поэтому шаги проговариваются вслух: без этого
# установка docker выглядит как зависший скрипт.
echo "==> Проверяю зависимости"
if ! command -v openssl >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "    ставлю openssl и curl (полминуты)"
  apt-get update -qq && apt-get install -y openssl curl
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "    ставлю docker — это 2-5 минут, вывода почти не будет"
  apt-get update -qq
  apt-get install -y docker.io docker-compose-v2
  systemctl enable --now docker
  echo "    docker готов"
else
  echo "    docker уже стоит"
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-v2
fi

echo "==> Определяю домен"
if [ "${1:-}" != "" ]; then
  DOMAIN="$1"
else
  IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
  if [ -z "$IP" ]; then
    echo "Не смог определить внешний IP. Передай домен аргументом." >&2
    exit 1
  fi
  # sslip.io отдаёт A-запись по имени вида 1-2-3-4.sslip.io, поэтому обычный
  # сертификат Let's Encrypt выпускается без покупки домена.
  DOMAIN="${IP//./-}.sslip.io"
fi
echo "    $DOMAIN"

echo "==> Готовлю .env"
if [ -f .env ]; then
  echo "    .env уже есть, оставляю как есть"
else
  cat > .env <<ENV
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
AUTH_SECRET=$(openssl rand -base64 32)
ENV
  chmod 600 .env
  echo "    создан, секреты сгенерированы"
fi

echo "==> Переключаю Prisma на postgresql"
sed -i -E 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma

echo "==> Собираю и поднимаю контейнеры"
echo "    первая сборка занимает 3-5 минут"
docker compose up -d --build

echo
echo "Готово. Открой: https://$DOMAIN"
echo
echo "Теперь заведи первого администратора:"
echo "  docker compose exec app npx tsx scripts/create-user.ts admin@ms.team \"Админ\" ADMIN"
echo
echo "Скрипт напечатает пароль один раз — сохрани его сразу."
