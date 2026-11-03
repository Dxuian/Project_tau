// /robots.txt: crawl the page, not the API; where the sitemap is.
import { SITE_URL } from '../lib/site.js';

export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/api/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
