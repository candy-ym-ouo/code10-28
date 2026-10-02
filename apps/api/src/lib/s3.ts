import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { getConfig } from "../config/env.js";
import { AppError } from "./errors.js";

let client: S3Client | undefined;
let publicClient: S3Client | undefined;

function createClient(endpoint: string): S3Client {
  const config = getConfig();
  return new S3Client({
    endpoint,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  });
}

export function getS3(): S3Client {
  if (!client) client = createClient(getConfig().S3_ENDPOINT);
  return client;
}

function getPublicS3(): S3Client {
  if (!publicClient) publicClient = createClient(getConfig().S3_PUBLIC_ENDPOINT ?? getConfig().S3_ENDPOINT);
  return publicClient;
}

export function publicObjectUrl(objectKey: string): string {
  const config = getConfig();
  const base = (config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT).replace(/\/$/, "");
  return `${base}/${config.S3_BUCKET}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

export async function createUploadUrl(objectKey: string, mimeType: string, sha256: string): Promise<string> {
  const config = getConfig();
  return getSignedUrl(
    getPublicS3(),
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey,
      ContentType: mimeType,
      Metadata: { sha256 },
    }),
    {
      expiresIn: config.UPLOAD_URL_TTL_SECONDS,
      signableHeaders: new Set(["content-type"]),
      unhoistableHeaders: new Set(["x-amz-meta-sha256"]),
    },
  );
}

export async function createPlaybackUrl(objectKey: string, originalName: string, contentType?: string): Promise<string> {
  const config = getConfig();
  return getSignedUrl(
    getPublicS3(),
    new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey,
      ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      ...(contentType ? { ResponseContentType: contentType } : {}),
    }),
    { expiresIn: config.PLAYBACK_URL_TTL_SECONDS },
  );
}

export async function verifyObject(objectKey: string, expectedSize: bigint, expectedSha256: string): Promise<void> {
  const config = getConfig();
  let head;
  try {
    head = await getS3().send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      throw new AppError(400, "UPLOAD_OBJECT_MISSING", "没有找到已上传的音频对象，请重新上传");
    }
    throw error;
  }
  if (BigInt(head.ContentLength ?? 0) !== expectedSize) {
    throw new AppError(400, "UPLOAD_SIZE_MISMATCH", "上传文件大小与声明不一致，请重新上传");
  }

  const object = await getS3().send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
  if (!object.Body) throw new AppError(400, "UPLOAD_OBJECT_MISSING", "没有找到已上传的音频对象");
  const hash = createHash("sha256");
  for await (const chunk of object.Body as Readable) hash.update(chunk as Buffer);
  if (hash.digest("hex") !== expectedSha256.toLowerCase()) {
    await deleteObject(objectKey).catch(() => undefined);
    throw new AppError(400, "UPLOAD_HASH_MISMATCH", "上传文件摘要与声明不一致，请重新上传");
  }
}

export async function deleteObject(objectKey: string): Promise<void> {
  const config = getConfig();
  await getS3().send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }));
}

export async function ensureBucket(): Promise<void> {
  const config = getConfig();
  try {
    await getS3().send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  } catch {
    await getS3().send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
  }
}
