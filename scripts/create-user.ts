/**
 * Заводит боевого пользователя. В отличие от `db:seed` не трогает существующие
 * данные и не создаёт демо-месяц.
 *
 *   npx tsx scripts/create-user.ts admin@ms.team "Админ" ADMIN
 *   npx tsx scripts/create-user.ts sko@ms.team "SKO" BUYER SKO
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const [email, name, role = 'BUYER', handle] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Использование: npx tsx scripts/create-user.ts <email> <имя> [ADMIN|LEAD|BUYER] [хендл]');
    process.exit(1);
  }
  if (!['ADMIN', 'LEAD', 'BUYER'].includes(role)) {
    console.error(`Неизвестная роль: ${role}`);
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    console.error(`Пользователь ${email} уже есть.`);
    process.exit(1);
  }

  // Пароль генерируем — так он не осядет в истории команд.
  const password = randomBytes(9).toString('base64url');
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name,
      role,
      passwordHash: await bcrypt.hash(password, 10),
    },
  });

  if (role === 'BUYER' || handle) {
    const rule = await prisma.salaryRule.findFirst();
    await prisma.buyer.create({
      data: {
        userId: user.id,
        handle: (handle ?? name).toUpperCase(),
        initials: (handle ?? name).slice(0, 2).toUpperCase(),
        salaryRuleId: rule?.id,
      },
    });
  }

  console.log(`Создан ${role}: ${email}`);
  console.log(`Пароль: ${password}`);
  console.log('Передай его лично и попроси сменить — смена пароля пока делается через этот же скрипт.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
