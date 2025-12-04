function extractDriveFileId(raw: string): string | null {
  const byPath = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (byPath?.[1]) {
    return byPath[1];
  }

  const byQuery = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (byQuery?.[1]) {
    return byQuery[1];
  }

  return null;
}

function buildStableViewLink(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view?usp=sharing`;
}

export function normalizeDriveUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed.length) return null;

  const fileId = extractDriveFileId(trimmed);

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();

    const hasTemporaryToken =
      parsed.searchParams.has('token') ||
      parsed.searchParams.has('Expires') ||
      parsed.searchParams.has('Signature');

    if (fileId && (hasTemporaryToken || hostname.endsWith('drive.google.com'))) {
      return buildStableViewLink(fileId);
    }

    return trimmed;
  } catch {
    return fileId ? buildStableViewLink(fileId) : trimmed;
  }
}
