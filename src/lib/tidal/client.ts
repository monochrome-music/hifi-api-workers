import type { Bindings } from "../../env";
import { API_VERSION } from "../../constants";
import { getTidalCredentials } from "../../env";
import { ApiError } from "../errors";
import { buildUrl, type QueryInput } from "../url";

interface TokenCache {
  cacheKey: string;
  accessToken: string | null;
  expiresAt: number;
  refreshPromise: Promise<string> | null;
}

interface JsonRequestOptions {
  env: Bindings;
  url: string;
  params?: QueryInput;
  token?: string;
}

interface RawRequestOptions extends JsonRequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
}

const tokenCache: TokenCache = {
  cacheKey: "",
  accessToken: null,
  expiresAt: 0,
  refreshPromise: null,
};

const REQUEST_TIMEOUT_MS = 12_000;
const TOKEN_TIMEOUT_MS = 8_000;

function now() {
  return Date.now();
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

function getCacheKey(env: Bindings): string {
  const credentials = getTidalCredentials(env);
  return credentials
    ? `${credentials.clientId}:${credentials.refreshToken}`
    : "";
}

function resetCacheIfCredentialsChanged(env: Bindings) {
  const nextKey = getCacheKey(env);
  if (nextKey !== tokenCache.cacheKey) {
    tokenCache.cacheKey = nextKey;
    tokenCache.accessToken = null;
    tokenCache.expiresAt = 0;
    tokenCache.refreshPromise = null;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "Upstream timeout");
    }

    throw new ApiError(503, "Connection error to Tidal");
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshAccessToken(env: Bindings): Promise<string> {
  resetCacheIfCredentialsChanged(env);

  const credentials = getTidalCredentials(env);
  if (!credentials) {
    throw new ApiError(
      500,
      "No Tidal credentials available; configure CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN",
    );
  }

  if (tokenCache.accessToken && now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  if (!tokenCache.refreshPromise) {
    tokenCache.refreshPromise = (async () => {
      const body = new URLSearchParams({
        client_id: credentials.clientId,
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
        scope: "r_usr+w_usr+w_sub",
      });

      const response = await fetchWithTimeout(
        "https://auth.tidal.com/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            authorization: basicAuthorization(
              credentials.clientId,
              credentials.clientSecret,
            ),
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
        },
        TOKEN_TIMEOUT_MS,
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new ApiError(
          401,
          `Token refresh failed: ${response.status} ${response.statusText} ${errorText}`,
        );
      }

      const data = (await response.json()) as {
        access_token: string;
        expires_in?: number;
      };
      tokenCache.accessToken = data.access_token;
      tokenCache.expiresAt = now() + ((data.expires_in ?? 3600) - 60) * 1000;
      return data.access_token;
    })().finally(() => {
      tokenCache.refreshPromise = null;
    });
  }

  return tokenCache.refreshPromise;
}

export async function getAccessToken(
  env: Bindings,
  forceRefresh = false,
): Promise<string> {
  resetCacheIfCredentialsChanged(env);

  if (!forceRefresh && tokenCache.accessToken && now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  return refreshAccessToken(env);
}

function mapUpstreamError(response: Response, includeRateLimit = false): never {
  if (response.status === 404) {
    throw new ApiError(404, "Resource not found");
  }

  if (includeRateLimit && response.status === 429) {
    throw new ApiError(429, "Upstream rate limited");
  }

  throw new ApiError(response.status, "Upstream API error");
}

export async function tidalJsonRequest(
  options: JsonRequestOptions,
): Promise<{ data: any; token: string }> {
  let token = options.token ?? (await getAccessToken(options.env));
  const target = buildUrl(options.url, options.params);

  const doFetch = async (accessToken: string) =>
    fetchWithTimeout(
      target,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      },
      REQUEST_TIMEOUT_MS,
    );

  let response = await doFetch(token);
  if (response.status === 401) {
    token = await getAccessToken(options.env, true);
    response = await doFetch(token);
  }

  if (!response.ok) {
    mapUpstreamError(response, true);
  }

  return {
    data: await response.json(),
    token,
  };
}

export async function makeVersionedGet(options: JsonRequestOptions) {
  const { data } = await tidalJsonRequest(options);
  return {
    version: API_VERSION,
    data,
  };
}

export async function tidalProxyRequest(
  options: RawRequestOptions,
): Promise<Response> {
  let token = options.token ?? (await getAccessToken(options.env));
  const target = buildUrl(options.url, options.params);

  const doFetch = async (accessToken: string) =>
    fetchWithTimeout(
      target,
      {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(options.headers ?? {}),
        },
        body: options.body ?? null,
      },
      REQUEST_TIMEOUT_MS,
    );

  let response = await doFetch(token);
  if (response.status === 401) {
    token = await getAccessToken(options.env, true);
    response = await doFetch(token);
  }

  return response;
}
