const LOCAL_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3002",
  "http://localhost:3002",
]);
const LOCAL_HOSTS = new Set(["127.0.0.1:3000", "localhost:3000", "127.0.0.1:3002", "localhost:3002"]);

export function isAllowedLocalRequest(origin: string | null, host: string | null, write: boolean): boolean {
  const normalizedHost = host?.toLowerCase();
  if (!normalizedHost || !LOCAL_HOSTS.has(normalizedHost)) return false;
  if (write && origin === null) return false;
  if (origin === null) return true;
  if (!LOCAL_ORIGINS.has(origin)) return false;
  return new URL(origin).host.toLowerCase() === normalizedHost;
}
