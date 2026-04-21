import { createHash, createHmac } from "node:crypto";
import { StorageAdapter } from "./index.js";

/**
 * Minimal S3-compatible adapter. No AWS SDK dependency — hand-rolled signing.
 * Works with: Hetzner Object Storage, Cloudflare R2, AWS S3, MinIO (including one
 * fronting a local NAS), Backblaze B2.
 *
 * Future: swap to a LocalFSAdapter or SFTPAdapter by implementing the same shape.
 */
export class S3StorageAdapter extends StorageAdapter {
  constructor({ endpoint, region, bucket, accessKeyId, secretAccessKey, pathStyle = true, publicBaseUrl = null }) {
    super();
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("S3StorageAdapter: endpoint, bucket, accessKeyId, secretAccessKey required");
    }
    this.endpoint = endpoint.replace(/\/$/, "");
    this.region = region || "auto";
    this.bucket = bucket;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.pathStyle = pathStyle;
    this.publicBaseUrl = publicBaseUrl;
  }

  _host() {
    return new URL(this.endpoint).host;
  }

  _objectUrl(key) {
    if (this.pathStyle) return `${this.endpoint}/${this.bucket}/${encodeURI(key)}`;
    return `${this.endpoint.replace("://", `://${this.bucket}.`)}/${encodeURI(key)}`;
  }

  async put(key, body, { contentType = "application/octet-stream", metadata = {} } = {}) {
    const url = this._objectUrl(key);
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const headers = await this._signedHeaders("PUT", url, bodyBuf, { contentType, metadata });
    const r = await fetch(url, { method: "PUT", body: bodyBuf, headers });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`S3 put ${r.status}: ${t.slice(0, 200)}`);
    }
    return {
      key,
      url: this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : url,
      bytes: bodyBuf.length,
    };
  }

  async get(key) {
    const url = this._objectUrl(key);
    const headers = await this._signedHeaders("GET", url, null);
    const r = await fetch(url, { method: "GET", headers });
    if (!r.ok) throw new Error(`S3 get ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async delete(key) {
    const url = this._objectUrl(key);
    const headers = await this._signedHeaders("DELETE", url, null);
    const r = await fetch(url, { method: "DELETE", headers });
    if (!r.ok && r.status !== 404) throw new Error(`S3 delete ${r.status}`);
  }

  async list(prefix = "", { limit = 100 } = {}) {
    const url = `${this.endpoint}/${this.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=${limit}`;
    const headers = await this._signedHeaders("GET", url, null);
    const r = await fetch(url, { method: "GET", headers });
    if (!r.ok) throw new Error(`S3 list ${r.status}`);
    const xml = await r.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    return keys;
  }

  async signedUrl(key, { expiresIn = 3600 } = {}) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]/g, "").replace(/\..{3}/, "");
    const dateStamp = amzDate.slice(0, 8);
    const credential = `${this.accessKeyId}/${dateStamp}/${this.region}/s3/aws4_request`;
    const canonicalUri = this.pathStyle ? `/${this.bucket}/${encodeURI(key)}` : `/${encodeURI(key)}`;
    const host = this.pathStyle ? this._host() : `${this.bucket}.${this._host()}`;
    const query = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresIn),
      "X-Amz-SignedHeaders": "host",
    });
    const canonicalRequest = [
      "GET",
      canonicalUri,
      query.toString(),
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = this._signingKey(dateStamp);
    const signature = hmac(signingKey, stringToSign).toString("hex");
    query.set("X-Amz-Signature", signature);
    return `${this.endpoint}${canonicalUri}?${query.toString()}`;
  }

  _signingKey(dateStamp) {
    const kDate = hmac("AWS4" + this.secretAccessKey, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
  }

  async _signedHeaders(method, urlStr, body, { contentType = "application/octet-stream", metadata = {} } = {}) {
    const u = new URL(urlStr);
    const amzDate = new Date().toISOString().replace(/[:-]/g, "").replace(/\..{3}/, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = body ? sha256(body) : "UNSIGNED-PAYLOAD";
    const headers = {
      host: u.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    };
    if (body) headers["content-type"] = contentType;
    for (const [k, v] of Object.entries(metadata)) {
      headers[`x-amz-meta-${k.toLowerCase()}`] = v;
    }
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map(h => `${h}:${String(headers[h]).trim()}\n`).join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalQuery = u.search
      ? u.search.slice(1).split("&").sort().join("&")
      : "";
    const canonicalRequest = [
      method,
      u.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = this._signingKey(dateStamp);
    const signature = hmac(signingKey, stringToSign).toString("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
  }
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}
function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}
