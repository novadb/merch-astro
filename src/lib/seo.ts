/** Canonical URL and language/region variants (`rel="canonical"`, `rel="alternate" hreflang`) for search engines. */
import { SITE_URL } from "astro:env/server";
import { HTML_LANG, REGIONS, type Region } from "./i18n";

export type Seo = {
  canonical: string;
  alternates: { hreflang: string; href: string }[];
  description?: string;
  /** Value of `<meta name="robots">`, e.g. `noindex, nofollow`; none: the default. */
  robots?: string;
};

/** What a product's SEO attributes ask of search engines. */
export type SeoHints = { description?: string; noIndex?: boolean; noFollow?: boolean };

/**
 * `path` is the page's clean URL (no filters, sorting, tracking parameters). `variants` holds the same content in every
 * region that has it, the page itself included: every variant lists all of them, `x-default` is `/`, which picks a region.
 * A page that asks not to be indexed lists no variants: it is not part of the language set.
 * The origin is `SITE_URL`, not the request's: a pre-rendered page has no request.
 */
export function seoOf(path: string, variants: Partial<Record<Region, string>>, hints: SeoHints = {}): Seo {
  const origin = SITE_URL.replace(/\/+$/, "");
  const alternates = hints.noIndex ? [] : REGIONS.flatMap((region) => (variants[region] ? [{ hreflang: HTML_LANG[region], href: origin + variants[region] }] : []));
  if (alternates.length) alternates.push({ hreflang: "x-default", href: `${origin}/` });
  const robots = [hints.noIndex && "noindex", hints.noFollow && "nofollow"].filter(Boolean).join(", ");
  return { canonical: origin + path, alternates, description: hints.description, robots: robots || undefined };
}
