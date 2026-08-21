import { PrismaMariaDb } from '@prisma/adapter-mariadb';

export function createPrismaAdapter(databaseUrl = process.env.DATABASE_URL): PrismaMariaDb {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const url = new URL(databaseUrl);
  if (url.protocol !== 'mysql:') {
    throw new Error('DATABASE_URL must use the mysql:// protocol.');
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL must include a database name.');
  }

  const publicKeyRetrieval = url.searchParams.get('allowPublicKeyRetrieval');
  if (publicKeyRetrieval && publicKeyRetrieval !== 'true' && publicKeyRetrieval !== 'false') {
    throw new Error('allowPublicKeyRetrieval must be either true or false.');
  }

  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase());

  return new PrismaMariaDb({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit: 10,
    connectTimeout: 5_000,
    // MySQL 8 uses caching_sha2_password by default. Public-key retrieval is safe
    // for the local development connection; remote connections must opt in.
    allowPublicKeyRetrieval: publicKeyRetrieval ? publicKeyRetrieval === 'true' : isLoopback,
  });
}
