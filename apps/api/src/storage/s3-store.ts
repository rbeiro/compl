import { GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MAX_OBJECT_BYTES, type ObjectStore } from "./object-store.js";

/**
 * S3-compatible storage. On Supabase: Storage > S3 connection
 * (endpoint https://<ref>.supabase.co/storage/v1/s3, an S3 access key pair).
 * Supabase registers each object in storage.objects, which the database
 * functions check. Any other S3 service works with the same code.
 */
export function createS3Store(options: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): ObjectStore {
  const s3 = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });

  return {
    async get(bucket, key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if ((res.ContentLength ?? 0) > MAX_OBJECT_BYTES) throw new Error("Object too large");
        const data = await res.Body!.transformToByteArray();
        return { data, contentType: res.ContentType };
      } catch (error) {
        if (error instanceof NoSuchKey || error instanceof NotFound) return null;
        throw error;
      }
    },
    async put(bucket, key, data, contentType) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return "exists";
      } catch (error) {
        if (!(error instanceof NotFound) && (error as { name?: string }).name !== "NotFound") throw error;
      }
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }));
      return "created";
    },
  };
}
