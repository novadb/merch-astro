/**
 * Pictures with a disk cache: a picture is fetched from NovaDB only once. The upstream route is content-addressed and
 * cannot change under its name (`files/{md5}{extension}`: ETag = MD5), so a cached file is never revalidated.
 *
 * A file's cache key is its URL below `/media`: `{md5}/original{ext}` and, scaled, `{md5}/{width}{ext}.webp`. Caddy serves
 * the folder as it is (`Caddyfile`) and never asks this code for a picture: the builder makes each one before it
 * publishes the page that shows it (`scripts/watch.mjs`), and `npm run dev` serves them through `src/pages/media/`.
 * What a reader needs to know about a file (type, ETag) is in `.meta`. Plain Node loads this file (the builder does):
 * no Astro and no other file of this project are imported.
 */
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";

type Meta = { contentType: string; etag: string; size: number };

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** An image file's name is its content address: the MD5 (GUID form, or 32 hex digits) and the extension. */
export const FILE_NAME = /^([0-9a-f]{32}|[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})\.[a-z0-9]{1,5}$/;

/** Whether an `If-None-Match` header names `etag` (a list of tags, weak or strong, or `*`). */
const matches = (header: string | null, etag: string) =>
  header !== null && header.split(",").some((tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag);

/**
 * The pictures kept in `cacheDir`. Pods or processes that share the folder share the pictures; delete it to reset the cache.
 * `fetchFile` gets a path below the Delivery root (`files/{md5}{ext}`) and returns NovaDB's answer: its caller brings the credentials.
 */
export function mediaStore(cacheDir: string, fetchFile: (path: string) => Promise<Response>) {
  /** Fetches in progress by cache key: concurrent requests for the same picture share one download. */
  const downloads = new Map<string, Promise<Meta | undefined>>();

  /** Where `key` (its path below the cache folder) keeps its meta data: out of the way of the files a web server serves. */
  const metaFile = (key: string) => path.join(cacheDir, ".meta", `${key}.json`);

  async function readMeta(key: string): Promise<Meta | undefined> {
    try {
      return JSON.parse(await readFile(metaFile(key), "utf-8")) as Meta;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  /** Writes `file` through a temporary file and a rename, so no reader ever sees half of it. The temporary file is not in the folder that is served. */
  async function writeAtomic(file: string, write: (temp: string) => Promise<unknown>): Promise<void> {
    const tempDir = path.join(cacheDir, ".tmp");
    await mkdir(tempDir, { recursive: true });
    await mkdir(path.dirname(file), { recursive: true });
    // Unique per call: the widths of one picture are made at the same moment, in pods that all run as process 1.
    const temp = path.join(tempDir, randomUUID());
    try {
      await write(temp);
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  /** Downloads `upstreamPath` into the cache. The meta file is written last: where it exists, the bytes do. */
  async function download(key: string, upstreamPath: string): Promise<Meta | undefined> {
    const upstream = await fetchFile(upstreamPath);
    if (upstream.status === 404) return undefined;
    const etag = upstream.headers.get("ETag");
    const contentType = upstream.headers.get("Content-Type");
    if (!upstream.ok || !upstream.body || !etag || !contentType) throw new Error(`Delivery ${upstream.status} for ${upstreamPath} (ETag ${etag}, Content-Type ${contentType})`);

    const file = path.join(cacheDir, key);
    await writeAtomic(file, (temp) => pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(temp)));
    return writeMeta(key, { contentType, etag, size: (await stat(file)).size });
  }

  async function writeMeta(key: string, meta: Meta): Promise<Meta> {
    await writeAtomic(metaFile(key), (temp) => writeFile(temp, JSON.stringify(meta), "utf-8"));
    return meta;
  }

  /** Cached meta for `key`, building the file first (once, however many requests ask) if it is not there yet. */
  async function ensure(key: string, build: () => Promise<Meta | undefined>): Promise<Meta | undefined> {
    const cached = await readMeta(key);
    if (cached) return cached;
    const pending = downloads.get(key) ?? build().finally(() => downloads.delete(key));
    downloads.set(key, pending);
    return pending;
  }

  /** The original, `{md5}/original{ext}`, fetched from `files/{md5}{ext}` if it is not cached yet. */
  const original = (md5: string, ext: string) => {
    const key = `${md5}/original${ext}`;
    return ensure(key, () => download(key, `files/${md5}${ext}`));
  };

  /** The original (fetched first if missing) scaled to `width` as WebP, without enlarging. Meta is written last, as in `download`. */
  const scaled = (md5: string, ext: string, width: number) => {
    const key = `${md5}/${width}${ext}.webp`;
    return ensure(key, async () => {
      const source = await original(md5, ext);
      if (!source) return undefined;
      const file = path.join(cacheDir, key);
      await writeAtomic(file, (temp) => sharp(path.join(cacheDir, `${md5}/original${ext}`), { animated: true }).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(temp));
      return writeMeta(key, { contentType: "image/webp", etag: `"${source.etag.replaceAll('"', "")}-w${width}"`, size: (await stat(file)).size });
    });
  };

  async function respond(key: string, meta: Meta | undefined, request: Request): Promise<Response> {
    if (!meta) return new Response("Not found", { status: 404 });

    const headers = new Headers({ "Cache-Control": "public, max-age=31536000, immutable", ETag: meta.etag });
    if (matches(request.headers.get("If-None-Match"), meta.etag)) return new Response(null, { status: 304, headers });
    headers.set("Content-Type", meta.contentType);
    headers.set("Content-Length", String(meta.size));
    return new Response(Readable.toWeb(createReadStream(path.join(cacheDir, key))) as ReadableStream, { status: 200, headers });
  }

  return {
    /** The original's meta, or undefined if NovaDB has no such file. */
    original,
    /** The scaled copy's meta, or undefined if NovaDB has no such file. */
    scaled,
    /** Serves `/media/{md5}/original{ext}`; 404 if NovaDB has no such file. The caller has validated both parts as a file name (`FILE_NAME`), which makes the cache key safe. */
    serveOriginal: async (md5: string, ext: string, request: Request) => respond(`${md5}/original${ext}`, await original(md5, ext), request),
    /** Serves `/media/{md5}/{width}{ext}.webp`, the file scaled to one of `MEDIA_WIDTHS`; the caller has validated all three. */
    serveScaled: async (md5: string, ext: string, width: number, request: Request) => respond(`${md5}/${width}${ext}.webp`, await scaled(md5, ext, width), request),
  };
}
