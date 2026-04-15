const etagStore = new Map<string, string>();

export function getStoredEtag(url: string): string | undefined {
  return etagStore.get(url);
}

export function setStoredEtag(url: string, etag: string): void {
  etagStore.set(url, etag);
}

export function buildFetchHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/x-protobuf",
  };
  const etag = getStoredEtag(url);
  if (etag) {
    headers["If-None-Match"] = etag;
  }
  return headers;
}

export function handleEtagResponse(url: string, response: Response): boolean {
  const etag = response.headers.get("etag");
  if (etag) setStoredEtag(url, etag);
  return response.status !== 304;
}
