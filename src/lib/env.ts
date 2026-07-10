export type AppEnvironment = {
  databasePath: string;
  uploadsPath: string;
  temporaryUploadsPath: string;
  appOrigin: string;
  secureCookies: boolean;
  trustProxyHeaders: boolean;
};

function booleanValue(
  name: string,
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either true or false`);
}

function normalizedOrigin(value: string): string {
  const origin = new URL(value).origin;
  if (origin === "null") throw new Error("APP_ORIGIN must be an HTTP(S) origin");
  return origin;
}

export function getEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AppEnvironment {
  const configuredSecureCookies = booleanValue(
    "SECURE_COOKIES",
    environment.SECURE_COOKIES,
    false,
  );

  return {
    databasePath: environment.DATABASE_PATH ?? "data/request-manager.db",
    uploadsPath: environment.UPLOADS_PATH ?? "data/uploads",
    temporaryUploadsPath: environment.TEMP_UPLOADS_PATH ?? "data/tmp",
    appOrigin: normalizedOrigin(environment.APP_ORIGIN ?? "http://localhost:3000"),
    secureCookies:
      environment.NODE_ENV === "production" || configuredSecureCookies,
    trustProxyHeaders: booleanValue(
      "TRUST_PROXY_HEADERS",
      environment.TRUST_PROXY_HEADERS,
      false,
    ),
  };
}
