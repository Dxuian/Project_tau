// drizzle-kit (server/dev db generate): ./schema.js -> SQL migrations in ./migrations, the folder
// `wrangler d1 migrations apply` reads. Paths are from server/.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({ dialect: 'sqlite', schema: './cloudflare/schema.js', out: './cloudflare/migrations' });
