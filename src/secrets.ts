import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SecretProvider {
  get(name: string): Promise<string | undefined>;
  create(name: string, value: string): Promise<boolean>;
}

interface CommandResult {
  code: number;
  stdout: string;
}

type CommandRunner = (
  file: string,
  args: readonly string[],
  stdin: string | undefined,
  signal: AbortSignal,
) => Promise<CommandResult>;

const runCommand: CommandRunner = (file, args, stdin, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { killSignal: "SIGKILL", shell: false, signal, stdio: "pipe" });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.stdin.on("error", () => undefined);
    child.once("error", () => reject(new Error("Secret command unavailable")));
    child.once("close", (code) => resolve({ code: code ?? 1, stdout }));
    child.stdin.end(stdin);
  });

const defaultCommandTimeoutMs = 10_000;

class SecretCommandTimeoutError extends Error {}

function assertKeychainName(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error("Invalid Keychain identifier");
}

export class MacOSKeychainSecretProvider implements SecretProvider {
  constructor(
    private readonly service: string,
    private readonly run: CommandRunner = runCommand,
    private readonly timeoutMs: number = defaultCommandTimeoutMs,
  ) {
    assertKeychainName(service);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new Error("Invalid Keychain timeout");
    }
  }

  private async execute(args: readonly string[], stdin?: string): Promise<CommandResult> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new SecretCommandTimeoutError("Keychain operation timed out"));
        controller.abort();
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([this.run("/usr/bin/security", args, stdin, controller.signal), timeout]);
    } catch (error) {
      if (timedOut) throw new SecretCommandTimeoutError("Keychain operation timed out");
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async get(name: string): Promise<string | undefined> {
    assertKeychainName(name);
    try {
      const result = await this.execute([
        "find-generic-password",
        "-s",
        this.service,
        "-a",
        name,
        "-w",
      ]);
      if (result.code === 44) return undefined;
      if (result.code !== 0) throw new Error("Secret command failed");
      return result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout;
    } catch (error) {
      if (error instanceof SecretCommandTimeoutError) throw new Error("Keychain operation timed out");
      throw new Error("Keychain access failed");
    }
  }

  async create(name: string, value: string): Promise<boolean> {
    assertKeychainName(name);
    try {
      const result = await this.execute(
        ["add-generic-password", "-s", this.service, "-a", name, "-w"],
        `${value}\n`,
      );
      if (result.code === 0) return true;
      if ((await this.get(name)) !== undefined) return false;
      throw new Error("Secret command failed");
    } catch (error) {
      if (error instanceof SecretCommandTimeoutError) throw new Error("Keychain operation timed out");
      throw new Error("Keychain update failed");
    }
  }
}

export interface CredentialIdentity {
  credentialId: string;
  generationId: string;
  subjectId: string;
}

export interface EncryptedCredential {
  version: 1;
  ciphertext: string;
  iv: string;
  tag: string;
}

function canonicalBase64(value: unknown, expectedBytes?: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("Invalid base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
    throw new Error("Invalid base64");
  }
  return decoded;
}

function aad(version: number, identity: CredentialIdentity): Buffer {
  return Buffer.from(JSON.stringify([version, identity.credentialId, identity.generationId, identity.subjectId]));
}

async function encryptionKey(provider: SecretProvider, keyName: string): Promise<Buffer> {
  try {
    return canonicalBase64(await provider.get(keyName), 32);
  } catch {
    throw new Error("Credential key is unavailable");
  }
}

export async function getOrCreateEncryptionKey(provider: SecretProvider, keyName: string): Promise<string> {
  const existing = await provider.get(keyName);
  if (existing !== undefined) {
    canonicalBase64(existing, 32);
    return existing;
  }

  const generated = randomBytes(32).toString("base64");
  if (await provider.create(keyName, generated)) return generated;
  const raced = await provider.get(keyName);
  canonicalBase64(raced, 32);
  return raced!;
}

export async function encryptCredential(
  provider: SecretProvider,
  keyName: string,
  identity: CredentialIdentity,
  plaintext: string,
): Promise<EncryptedCredential> {
  if (plaintext.length === 0) throw new Error("Credential plaintext is required");
  const version = 1 as const;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(provider, keyName), iv);
  cipher.setAAD(aad(version, identity));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    version,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function parseEnvelope(value: unknown): { version: 1; ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid envelope");
  const envelope = value as Record<string, unknown>;
  if (
    envelope.version !== 1 ||
    Object.keys(envelope).length !== 4 ||
    !["version", "ciphertext", "iv", "tag"].every((key) => Object.hasOwn(envelope, key))
  ) {
    throw new Error("Invalid envelope");
  }
  return {
    version: 1,
    ciphertext: canonicalBase64(envelope.ciphertext),
    iv: canonicalBase64(envelope.iv, 12),
    tag: canonicalBase64(envelope.tag, 16),
  };
}

export async function decryptCredential(
  provider: SecretProvider,
  keyName: string,
  identity: CredentialIdentity,
  encrypted: unknown,
): Promise<string> {
  try {
    const envelope = parseEnvelope(encrypted);
    const decipher = createDecipheriv("aes-256-gcm", await encryptionKey(provider, keyName), envelope.iv);
    decipher.setAAD(aad(envelope.version, identity));
    decipher.setAuthTag(envelope.tag);
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Credential decryption failed");
  }
}
