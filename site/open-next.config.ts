// The site on Cloudflare Workers through OpenNext (npm run cf:build). The
// defaults suffice: no ISR or on-demand revalidation is used.
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig();
