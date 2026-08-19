import 'dotenv/config';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { createPrismaAdapter } from '../src/database/prisma-adapter';
import { PrismaClient } from '../src/generated/prisma/client';
import { UserStatus } from '../src/generated/prisma/enums';

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

async function bootstrapAdmin(): Promise<void> {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim() || 'admin';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!password) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required.');
  }

  const existingUser = await prisma.user.findUnique({ where: { username } });
  const existingSuperAdmin = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
  if (existingSuperAdmin) {
    console.log(
      `Bootstrap skipped: platform super administrator "${existingSuperAdmin.username}" already exists.`,
    );
    return;
  }
  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        isSuperAdmin: true,
        status: UserStatus.ACTIVE,
        authVersion: { increment: 1 },
      },
    });
    console.log(
      `Bootstrap complete: existing user "${username}" is now the platform super administrator.`,
    );
    return;
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await prisma.user.create({
    data: {
      id: uuidv7(),
      username,
      displayName: username,
      status: UserStatus.ACTIVE,
      isSuperAdmin: true,
      passwordCredential: { create: { passwordHash } },
    },
  });

  console.log(`Bootstrap complete: user "${username}" created.`);
}

bootstrapAdmin()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Admin bootstrap failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
