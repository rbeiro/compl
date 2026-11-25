/**
 * Private file storage. Every bucket is private; only the API reads or writes,
 * after the database authorizes the request. Keys are content-addressed
 * (sha256), so objects are never overwritten.
 */
export interface ObjectStore {
  get(bucket: string, key: string): Promise<StoredObject | null>;
  /** Stores the object unless the key already exists. */
  put(bucket: string, key: string, data: Uint8Array, contentType: string): Promise<"created" | "exists">;
}

export type StoredObject = { data: Uint8Array; contentType?: string };

/** Largest file the API accepts or serves (same as the legacy Edge Functions). */
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;
