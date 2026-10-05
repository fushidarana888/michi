const ANKI_LOOPBACK_RE = /^http:\/\/(?:127\.0\.0\.1|localhost):8765(?:\/|$)/i

type LoopbackRequestInit = RequestInit & {
  targetAddressSpace?: 'loopback'
}

let installed = false

export function installLoopbackFetchSupport() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const nativeFetch = window.fetch.bind(window)

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url

    if (!ANKI_LOOPBACK_RE.test(url)) return nativeFetch(input, init)

    const nextInit: LoopbackRequestInit = {
      ...(init || {}),
      mode: 'cors',
      targetAddressSpace: 'loopback',
    }

    return nativeFetch(input, nextInit)
  }) as typeof window.fetch
}
