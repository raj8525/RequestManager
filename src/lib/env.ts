export type AppEnvironment = {
  databasePath: string;
  uploadsPath: string;
  temporaryUploadsPath: string;
  appOrigin: string;
  secureCookies: boolean;
};

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("SECURE_COOKIES must be either true or false");
}

function normalizedOrigin(value: string): string {
  const origin = new URL(value).origin;
  if (origin === "null") throw new Error("APP_ORIGIN must be an HTTP(S) origin");
  return origin;
}

export function getEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AppEnvironment {
  return {
    databasePath: environment.DATABASE_PATH ?? "data/request-manager.db",
    uploadsPath: environment.UPLOADS_PATH ?? "data/uploads",
    temporaryUploadsPath: environment.TEMP_UPLOADS_PATH ?? "data/tmp",
    appOrigin: normalizedOrigin(environment.APP_ORIGIN ?? "http://localhost:3000"),
    secureCookies: booleanValue(environment.SECURE_COOKIES, false),
  };
}
