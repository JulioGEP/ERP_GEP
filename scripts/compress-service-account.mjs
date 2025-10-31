#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { stdin as input } from "node:process";
import { gzipSync, gunzipSync } from "node:zlib";

function printUsage() {
  console.error(`Usage: node scripts/compress-service-account.mjs [--decode] [file|-]

Encode (default):
  node scripts/compress-service-account.mjs service-account.json > output.txt

Decode:
  node scripts/compress-service-account.mjs --decode < compressed.txt
`);
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function encode(value) {
  const normalized = value.replace(/\r\n/g, "\n");
  const compressed = gzipSync(Buffer.from(normalized, "utf8"));
  return `base64gz:${compressed.toString("base64")}`;
}

function decode(value) {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.startsWith("base64gz:")
    ? trimmed.slice("base64gz:".length)
    : trimmed.startsWith("gzbase64:")
      ? trimmed.slice("gzbase64:".length)
      : trimmed;
  const buffer = Buffer.from(withoutPrefix, "base64");
  return gunzipSync(buffer).toString("utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--decode") ? "decode" : "encode";
  const filtered = args.filter((arg) => !arg.startsWith("--"));
  const file = filtered[0];

  let raw;
  if (file && file !== "-") {
    try {
      raw = readFileSync(file, "utf8");
    } catch (error) {
      console.error(`Unable to read input file '${file}':`, error instanceof Error ? error.message : error);
      process.exitCode = 1;
      return;
    }
  } else {
    raw = await readAll(input);
  }

  if (!raw) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const output = mode === "decode" ? decode(raw) : encode(raw);
    process.stdout.write(output.trimEnd());
    if (!output.endsWith("\n")) {
      process.stdout.write("\n");
    }
  } catch (error) {
    console.error(`Failed to ${mode} service account payload:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
