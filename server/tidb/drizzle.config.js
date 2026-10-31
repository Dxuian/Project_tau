// drizzle-kit (server/dev db generate): ./schema.js -> SQL migrations in ./migrations. Paths are from server/.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({ dialect: 'mysql', schema: './tidb/schema.js', out: './tidb/migrations' });
