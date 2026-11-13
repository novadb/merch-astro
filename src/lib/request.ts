/**
 * What every route reads from a request: the region from the path (language, texts, market and currency follow from
 * it) and the fields of a POST form. The site neither reads nor writes a query string: a filtered view or a search has
 * no URL of its own, so nothing a visitor typed ends up in a link, a log or the index.
 */
import { isRegion, type Region } from "./i18n";

/** The fields of a posted form (filters, sorting, search); a body that is no form is a 400. */
export async function formOf(request: Request): Promise<URLSearchParams | Response> {
  const fields = await request.formData().catch(() => undefined);
  if (!fields) return new Response(null, { status: 400 });
  const form = new URLSearchParams();
  for (const [name, value] of fields) if (typeof value === "string") form.append(name, value);
  return form;
}

/** The region (`de`, `uk` or `us`) a route's `region` segment or the field `lang` of `POST /api/suggest` holds; anything else, e.g. `en`, is none. */
export const regionOf = (value: unknown): Region | undefined => (isRegion(value) ? value : undefined);
