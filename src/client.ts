import type { Config } from "./config.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/** Error carrying the HTTP status and parsed response body from Coolify. */
export class CoolifyError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Coolify API error ${status}: ${stringifyBody(body)}`);
    this.name = "CoolifyError";
  }
}

function stringifyBody(body: unknown): string {
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

/** Thin typed wrapper around the Coolify REST API (`/api/v1`). */
export class CoolifyClient {
  private readonly apiBase: string;

  constructor(private readonly cfg: Config) {
    this.apiBase = `${cfg.baseUrl}/api/v1`;
  }

  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(this.apiBase + (path.startsWith("/") ? path : `/${path}`));
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new CoolifyError(0, `Request timed out after ${this.cfg.timeoutMs}ms`);
      }
      throw new CoolifyError(0, err instanceof Error ? err.message : String(err));
    }
    clearTimeout(timer);

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) throw new CoolifyError(res.status, data);
    return data as T;
  }

  // --- Convenience helpers --------------------------------------------------
  get<T = unknown>(path: string, query?: RequestOptions["query"]) {
    return this.request<T>("GET", path, { query });
  }
  post<T = unknown>(path: string, body?: unknown, query?: RequestOptions["query"]) {
    return this.request<T>("POST", path, { body, query });
  }
  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, { body });
  }
  delete<T = unknown>(path: string, query?: RequestOptions["query"]) {
    return this.request<T>("DELETE", path, { query });
  }
}
