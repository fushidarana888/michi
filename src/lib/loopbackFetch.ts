const ANKI_LOOPBACK_RE = /^http:\/\/(?:127\.0\.0\.1|localhost):8765(?:\/|$)/i

type LoopbackRequestInit = RequestInit & {
  targetAddressSpace?: 'loopback'
}

let installed = false

function alternateLoopbackUrl(url: string) {
  if (/127\.0\.0\.1:8765/i.test(url)) return url.replace(/127\.0\.0\.1:8765/i, 'localhost:8765')
  if (/localhost:8765/i.test(url)) return url.replace(/localhost:8765/i, '127.0.0.1:8765')
  return url
}

function prepareInit(init?: RequestInit): LoopbackRequestInit {
  const headers = new Headers(init?.headers || {})

  // A JSON Content-Type makes the browser send an OPTIONS preflight before
  // requestPermission. On some Chrome/LNA combinations that preflight can be
  // rejected before AnkiConnect gets a chance to show its permission dialog.
  // AnkiConnect parses the JSON body regardless of this header, so using a
  // simple text/plain POST is both valid and more compatible.
  headers.delete('Content-Type')
  headers.delete('content-type')

  return {
    ...(init || {}),
    headers,
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    targetAddressSpace: 'loopback',
  }
}

export function installLoopbackFetchSupport() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const nativeFetch = window.fetch.bind(window)

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url

    if (!ANKI_LOOPBACK_RE.test(url)) return nativeFetch(input, init)

    const nextInit = prepareInit(init)

    try {
      return await nativeFetch(url, nextInit)
    } catch (firstError) {
      const alternate = alternateLoopbackUrl(url)
      if (alternate === url) throw firstError

      try {
        return await nativeFetch(alternate, nextInit)
      } catch {
        throw firstError
      }
    }
  }) as typeof window.fetch
}
