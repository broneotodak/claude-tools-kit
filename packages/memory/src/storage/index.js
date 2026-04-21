/**
 * Storage adapter interface.
 *
 * Implementations must provide: put, get, delete, list, signedUrl.
 * The default impl is S3-compatible (Hetzner Object Storage, R2, AWS, MinIO, or a local NAS behind a MinIO/rclone proxy).
 * Swap the adapter when you move to NAS without touching calling code.
 */

export class StorageAdapter {
  /**
   * @param {string} key  e.g. "audio/2026/04/abc.mp3"
   * @param {Buffer|Uint8Array|ReadableStream} body
   * @param {{contentType?:string,metadata?:Record<string,string>}} [opts]
   * @returns {Promise<{key:string,url:string,bytes:number}>}
   */
  async put(key, body, opts = {}) { throw new Error("not implemented"); }

  async get(key) { throw new Error("not implemented"); }
  async delete(key) { throw new Error("not implemented"); }
  async list(prefix, { limit } = {}) { throw new Error("not implemented"); }

  /**
   * Presigned URL for client-side retrieval. Optional.
   */
  async signedUrl(key, { expiresIn = 3600 } = {}) { throw new Error("not implemented"); }
}

export { S3StorageAdapter } from "./s3.js";
