/**
 * The latest Android build, read from the repo's GitHub Releases.
 *
 * The `Mobile build (local APK)` workflow attaches two copies of the same APK to
 * every `mobile-v*` release: a versioned one, and `extrememedics-latest.apk` so
 * that a permanent URL exists. We still query the API rather than only linking
 * the permanent URL, because the page has to *say* which version it is offering
 * and what changed — a download button with no version on it is not something
 * anyone should install on a phone they rely on.
 */

export const GITHUB_REPO = 'hackohackob/events'

/** Always resolves to the newest release's stable-named asset. */
export const STABLE_APK_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/extrememedics-latest.apk`
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`

export interface ApkRelease {
  /** e.g. "4.5.0" — the tag with its `mobile-v` prefix stripped. */
  version: string
  tag: string
  publishedAt: string | null
  /** Direct download for this exact build. */
  downloadUrl: string
  sizeBytes: number | null
  /** Raw release notes as GitHub generated them; may be empty. */
  notes: string
  releaseUrl: string
}

interface GhAsset {
  name: string
  size: number
  browser_download_url: string
}

interface GhRelease {
  tag_name: string
  published_at: string | null
  body: string | null
  html_url: string
  assets: GhAsset[]
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

/**
 * Fetch the latest release. Returns null rather than throwing — GitHub's
 * unauthenticated API is rate-limited, and a page that 500s because of someone
 * else's traffic is worse than one that falls back to the permanent link.
 */
export async function fetchLatestApkRelease(): Promise<ApkRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 120 },
    })
    if (!res.ok) return null
    const release = (await res.json()) as GhRelease

    // Prefer the versioned asset for the visible link so the filename on disk
    // says what it is; fall back to the stable name, then to any .apk.
    const apks = release.assets.filter(a => a.name.endsWith('.apk'))
    const asset =
      apks.find(a => /extrememedics-v\d/.test(a.name)) ??
      apks.find(a => a.name === 'extrememedics-latest.apk') ??
      apks[0] ??
      null

    return {
      version: release.tag_name.replace(/^mobile-v/, ''),
      tag: release.tag_name,
      publishedAt: release.published_at,
      downloadUrl: asset?.browser_download_url ?? STABLE_APK_URL,
      sizeBytes: asset?.size ?? null,
      notes: release.body ?? '',
      releaseUrl: release.html_url,
    }
  } catch {
    return null
  }
}

export interface NoteLine {
  kind: 'heading' | 'bullet' | 'text'
  text: string
}

/**
 * GitHub's auto-generated notes are markdown of a very predictable shape
 * (`## What's Changed`, `* message by @user in <url>`). Reduce them to lines the
 * page can render, stripping the attribution noise — nobody downloading an APK
 * needs the PR link, they need to know what changed.
 */
export function parseReleaseNotes(body: string): NoteLine[] {
  const out: NoteLine[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('**Full Changelog**')) continue
    if (line.startsWith('#')) {
      out.push({ kind: 'heading', text: line.replace(/^#+\s*/, '') })
      continue
    }
    if (line.startsWith('* ') || line.startsWith('- ')) {
      const text = line
        .slice(2)
        .replace(/\s+by\s+@[\w-]+\s+in\s+\S+$/i, '')
        .replace(/\s+in\s+https?:\/\/\S+$/i, '')
        .trim()
      if (text) out.push({ kind: 'bullet', text })
      continue
    }
    out.push({ kind: 'text', text: line })
  }
  return out
}
