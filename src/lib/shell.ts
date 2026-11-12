/** What the header, the footer and the shop need on every page of a region. */
import { SHOPIFY_DOMAIN, SHOPIFY_STOREFRONT_TOKEN } from "astro:env/server";
import type { Region } from "./i18n";
import { loadText } from "./page-data";
import { loadSite } from "./site";

export async function loadShell(region: Region) {
  const [site, text] = await Promise.all([loadSite(region), loadText(region)]);
  return {
    text,
    home: { url: site.home.url, title: site.home.title },
    nav: site.home.children.map((p) => ({ url: p.url, title: p.navTitle, children: p.children.map((c) => ({ url: c.url, title: c.navTitle })) })),
    /** Without both values there are no buy buttons and no cart, silently. */
    shop: SHOPIFY_DOMAIN && SHOPIFY_STOREFRONT_TOKEN ? { domain: SHOPIFY_DOMAIN, token: SHOPIFY_STOREFRONT_TOKEN } : undefined,
  };
}
