import fs from "node:fs";
import path from "node:path";
import { paths } from "../lib/paths.js";

interface ProviderSecret {
  apiKey: string;
}

/** Read API key from the secrets file for a given provider. Never logs the key. */
export function readApiKey(providerName: string): string {
  const file = path.join(paths.secrets, `${providerName}.json`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    throw new Error(
      `Provider "${providerName}" is not configured — save an API key in Settings first`
    );
  }
  const parsed = JSON.parse(raw) as ProviderSecret;
  if (!parsed.apiKey) {
    throw new Error(`Invalid secrets file for provider "${providerName}"`);
  }
  return parsed.apiKey;
}
