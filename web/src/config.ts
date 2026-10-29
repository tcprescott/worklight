export interface AppConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  /** e.g. https://worklight.auth.us-east-1.amazoncognito.com, or null when Google sign-in is off. */
  hostedUiUrl: string | null;
  googleEnabled: boolean;
  /** Local dev server only (dev/devserver.py): sign-in is simulated, no Cognito. */
  devAuth?: boolean;
}

let config: AppConfig | undefined;

/** Written by the CDK deploy next to index.html, so one build works for any stack. */
export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Missing /config.json. Deploy the stack, or copy public/config.example.json for local dev.");
  config = (await res.json()) as AppConfig;
  return config;
}

export function getConfig(): AppConfig {
  if (!config) throw new Error("Config not loaded");
  return config;
}
