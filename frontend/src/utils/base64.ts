function getBuffer(): typeof Buffer | undefined {
  if (typeof globalThis === "undefined") {
    return undefined;
  }
  return typeof (globalThis as any).Buffer === "function" ? (globalThis as any).Buffer : undefined;
}

function hasBtoa(): boolean {
  return typeof globalThis !== "undefined" && typeof globalThis.btoa === "function";
}

function hasAtob(): boolean {
  return typeof globalThis !== "undefined" && typeof globalThis.atob === "function";
}

function encodeWithBtoa(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return globalThis.btoa(binary);
}

function decodeWithAtob(base64: string): Uint8Array {
  const atobImpl = globalThis.atob as (input: string) => string;
  const binary = atobImpl(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    return "";
  }

  const BufferImpl = getBuffer();
  if (BufferImpl) {
    return BufferImpl.from(bytes).toString("base64");
  }

  if (hasBtoa()) {
    return encodeWithBtoa(bytes);
  }

  throw new Error("No se puede codificar datos base64 en este entorno.");
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof base64 !== "string" || base64.length === 0) {
    return new Uint8Array();
  }

  const BufferImpl = getBuffer();
  if (BufferImpl) {
    return Uint8Array.from(BufferImpl.from(base64, "base64"));
  }

  if (hasAtob()) {
    return decodeWithAtob(base64);
  }

  throw new Error("No se puede decodificar datos base64 en este entorno.");
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return uint8ArrayToBase64(new Uint8Array(buffer));
}

export async function blobOrFileToBase64(input: Blob | File): Promise<string> {
  const arrayBuffer = await input.arrayBuffer();
  return arrayBufferToBase64(arrayBuffer);
}
