import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

let appUrl: Promise<string> | undefined;

/**
 * The public site URL for emailed links. Set APP_URL directly once a custom domain exists;
 * until then the stack writes the CloudFront URL to SSM (an env var would make a dependency cycle).
 */
export function getAppUrl(): Promise<string> {
  appUrl ??= (async () => {
    if (process.env.APP_URL) return process.env.APP_URL;
    const name = process.env.APP_URL_PARAM;
    if (!name) throw new Error("Set APP_URL or APP_URL_PARAM");
    const res = await new SSMClient({}).send(new GetParameterCommand({ Name: name }));
    if (!res.Parameter?.Value) throw new Error(`SSM parameter ${name} is empty`);
    return res.Parameter.Value.replace(/\/+$/, "");
  })();
  return appUrl;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
