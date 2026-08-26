/** Смена пароля: npx tsx scripts/set-password.ts sko@ms.team */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const [email, explicit] = process.argv.slice(2);
  if (!email) {
    console.error('Использование: npx tsx scripts/set-password.ts <email> [пароль]');
    process.exit(1);
  }
  const password = explicit ?? randomBytes(9).toString('base64url');
  await prisma.user.update({
    where: { email: email.toLowerCase() },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log(`Пароль для ${email}: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
