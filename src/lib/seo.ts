/** Canonical URL and language/region variants (`rel="canonical"`, `rel="alternate" hreflang`) for search engines. */
import { SITE_URL } from "astro:env/server";
import { HTML_LANG, REGIONS, type Region } from "./i18n";

export type Seo = { canonical: string; alternates: { hreflang: string; href: string }[] };

/**
 * `path` is the page's clean URL (no filters, sorting, tracking parameters). `variants` holds the same content in every
 * region that has it, the page itself included: every variant lists all of them, `x-default` is `/`, which picks a region.
 * The origin is `SITE_URL`, not the request's: a pre-rendered page has no request.
 */
export function seoOf(path: string, variants: Partial<Record<Region, string>>): Seo {
  const origin = SITE_URL.replace(/\/+$/, "");
  const alternates = REGIONS.flatMap((region) => (variants[region] ? [{ hreflang: HTML_LANG[region], href: origin + variants[region] }] : []));
  if (alternates.length) alternates.push({ hreflang: "x-default", href: `${origin}/` });
  return { canonical: origin + path, alternates };
}
