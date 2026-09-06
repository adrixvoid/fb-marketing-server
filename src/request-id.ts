import { randomUUID } from "node:crypto";

export function requestId(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : randomUUID();
}
