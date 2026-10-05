import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import './AnkiConnectionHelpPortal.css'

export function AnkiConnectionHelpPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function sync() {
      const panel = document.querySelector<HTMLElement>('.anki-panel')
      const message = panel?.querySelector<HTMLElement>('.anki-message')?.textContent || ''
      const failed = /не удалось связаться|не ответил|не удалось подключиться/i.test(message)
      setTarget(panel)
      setVisible(Boolean(panel && failed))
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])

  if (!target || !visible) return null

  function retry() {
    const buttons = [...target!.querySelectorAll<HTMLButtonElement>('.anki-actions button')]
    const connectButton = buttons.find((button) => /подключить anki|проверить anki/i.test(button.textContent || ''))
    connectButton?.click()
  }

  return createPortal(
    <div className="anki-connection-help">
      <AlertTriangle size={19} />
      <div>
        <strong>AnkiConnect пока не запущен или браузер не может до него достучаться.</strong>
        <p>Если дополнение только что установлено, полностью закрой Anki и открой заново. Надпись «Перезапустите Anki, чтобы применить изменения» означает, что AnkiConnect ещё не работает.</p>
        <p>Если Anki уже перезапущен: открой «Инструменты → Дополнения → AnkiConnect → Проверить обновления». Затем попробуй ещё раз. Разрешение для <code>{window.location.origin}</code> AnkiConnect запросит сам.</p>
        <button type="button" className="secondary-button" onClick={retry}><RefreshCw size={16} /> Проверить после перезапуска</button>
      </div>
    </div>,
    target,
  )
}
