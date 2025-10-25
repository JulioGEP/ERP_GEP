import { describe, expect, it } from "vitest";
import { blobOrFileToBase64 } from "../base64";

describe("blobOrFileToBase64", () => {
  function createMockBlob(data: Uint8Array): Blob {
    const copy = new Uint8Array(data);
    return {
      arrayBuffer: async () => copy.buffer,
    } as unknown as Blob;
  }

  it("convierte blobs grandes usando Buffer cuando está disponible", async () => {
    const size = 1_048_576 + 321; // > 1 MB para forzar múltiples chunks
    const data = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) {
      data[index] = index % 256;
    }
    const blob = createMockBlob(data);

    const result = await blobOrFileToBase64(blob);

    expect(result).toBe(Buffer.from(data).toString("base64"));
  });

  it("usa btoa cuando Buffer no está disponible", async () => {
    const size = 0x8000 * 2 + 5; // fuerza más de un chunk en btoa
    const data = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) {
      data[index] = (index * 31) % 256;
    }
    const blob = createMockBlob(data);

    const expected = Buffer.from(data).toString("base64");
    const originalBuffer = (globalThis as any).Buffer;
    const originalBtoa = (globalThis as any).btoa;

    const bufferReference = originalBuffer;
    expect(bufferReference).toBeDefined();

    try {
      (globalThis as any).Buffer = undefined;
      (globalThis as any).btoa = (binary: string) =>
        bufferReference.from(binary, "binary").toString("base64");

      const result = await blobOrFileToBase64(blob);
      expect(result).toBe(expected);
    } finally {
      (globalThis as any).Buffer = originalBuffer;
      if (originalBtoa) {
        (globalThis as any).btoa = originalBtoa;
      } else {
        delete (globalThis as any).btoa;
      }
    }
  });
});
