import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Pool } from "../db/client.js";
import type { ObjectStore } from "./object-store.js";

/**
 * Development/test storage on the local filesystem. Like Supabase Storage, it
 * records each object in storage.objects, because the database functions check
 * that table before granting access. Not for production.
 */
export function createLocalStore(root: string, pool: Pool): ObjectStore {
  const base = resolve(root);
  const pathOf = (bucket: string, key: string) => {
    const full = resolve(join(base, bucket, key));
    if (!full.startsWith(base + sep)) throw new Error("Invalid object key");
    return full;
  };

  return {
    async get(bucket, key) {
      try {
        return { data: new Uint8Array(await readFile(pathOf(bucket, key))) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async put(bucket, key, data, contentType) {
      const file = pathOf(bucket, key);
      await mkdir(dirname(file), { recursive: true });
      try {
        await writeFile(file, data, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists";
        throw error;
      }
      await pool.query(
        `insert into storage.objects (bucket_id, name, metadata)
         select $1, $2, jsonb_build_object('mimetype', $3::text, 'size', $4::int)
         where not exists (select 1 from storage.objects where bucket_id = $1 and name = $2)`,
        [bucket, key, contentType, data.byteLength],
      );
      return "created";
    },
  };
}
