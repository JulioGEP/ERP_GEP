import { describe, expect, it } from "vitest";
import { base64ToUint8Array, blobOrFileToBase64, uint8ArrayToBase64 } from "../base64";

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

describe("base64ToUint8Array / uint8ArrayToBase64", () => {
  const originalBuffer = (globalThis as any).Buffer;
  const originalAtob = (globalThis as any).atob;

  const sample = new Uint8Array([0, 127, 255, 34, 150, 203, 10]);

  it("usa Buffer cuando está disponible", () => {
    const base64 = uint8ArrayToBase64(sample);
    const result = base64ToUint8Array(base64);

    expect(result).toEqual(sample);
  });

  it("usa atob cuando Buffer no está disponible", () => {
    const bufferReference = originalBuffer;
    expect(bufferReference).toBeDefined();

    const base64 = Buffer.from(sample).toString("base64");

    try {
      (globalThis as any).Buffer = undefined;
      (globalThis as any).atob = (value: string) => bufferReference.from(value, "base64").toString("binary");

      const result = base64ToUint8Array(base64);
      expect(result).toEqual(sample);
    } finally {
      (globalThis as any).Buffer = originalBuffer;
      if (originalAtob) {
        (globalThis as any).atob = originalAtob;
      } else {
        delete (globalThis as any).atob;
      }
    }
  });
});
