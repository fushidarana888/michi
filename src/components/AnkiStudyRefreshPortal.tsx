import { useEffect } from 'react'

export function AnkiStudyRefreshPortal() {
  useEffect(() => {
    let timer: number | null = null

    function check() {
      const message = document.querySelector<HTMLElement>('.anki-message')?.textContent?.trim() || ''
      if (!message.startsWith('Готово:') || timer !== null) return
      timer = window.setTimeout(() => window.location.reload(), 650)
    }

    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  return null
}
