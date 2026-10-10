// Save a generated file. In a normal browser this is a plain download. When the
// app runs as a claude.ai artifact preview, downloads go through the viewer's
// save prompt, which only accepts some extensions.

type Downloads = { save: (r: { filename: string; data: string | Uint8Array }) => Promise<unknown> };

const ARTIFACT_OK = /\.(csv|xlsx|json|zip|txt|html|md)$/i;

function inArtifact(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { claude?: { use?: unknown } }).claude?.use === 'function';
}

let downloadsPromise: Promise<Downloads | null> | null = null;
function artifactDownloads(): Promise<Downloads | null> {
  if (!downloadsPromise) {
    const c = (window as unknown as { claude: { use: (n: string) => Promise<Downloads | null> } }).claude;
    downloadsPromise = c.use('downloads').catch(() => null);
  }
  return downloadsPromise;
}

/** Returns a short message for the toast, or null when nothing needs saying. */
export async function saveFile(filename: string, data: string | Uint8Array, mime: string): Promise<string | null> {
  if (inArtifact()) {
    const dl = await artifactDownloads();
    if (!dl) return 'Downloads are not available in this preview.';
    let name = filename;
    let note: string | null = null;
    if (!ARTIFACT_OK.test(name)) {
      if (/\.km[lz]$/i.test(name)) {
        // The preview's save prompt does not accept .kml/.kmz.
        name = `${name}.txt`;
        note = 'This preview can only save it as .txt. Remove the .txt ending to use it as a KML. The hosted site saves a plain .kml.';
      } else if (/\.geojson$/i.test(name)) {
        name = name.replace(/\.geojson$/i, '.json');
      }
    }
    try {
      await dl.save({ filename: name, data });
      return note;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return null;
      return `Could not save ${name}${code ? ` (${code})` : ''}.`;
    }
  }
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return null;
}
