function getBuffer(): typeof Buffer | undefined {
  if (typeof globalThis === "undefined") {
    return undefined;
  }
  return typeof (globalThis as any).Buffer === "function" ? (globalThis as any).Buffer : undefined;
}

function hasBtoa(): boolean {
  return typeof globalThis !== "undefined" && typeof globalThis.btoa === "function";
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

export async function blobOrFileToBase64(input: Blob | File): Promise<string> {
  const arrayBuffer = await input.arrayBuffer();
  const BufferImpl = getBuffer();

  if (BufferImpl) {
    return BufferImpl.from(arrayBuffer).toString("base64");
  }

  if (hasBtoa()) {
    const bytes = new Uint8Array(arrayBuffer);
    return encodeWithBtoa(bytes);
  }

  throw new Error("No se puede convertir el archivo a base64 en este entorno.");
}
