// /sitemap.xml: the one screen (dated by the build).
import { SITE_URL } from '../lib/site.js';

export default function sitemap() {
  return [{ url: `${SITE_URL}/`, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 }];
}
