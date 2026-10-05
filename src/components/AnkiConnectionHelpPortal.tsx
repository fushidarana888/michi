import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Copy, RefreshCw } from 'lucide-react'
import './AnkiConnectionHelpPortal.css'

export function AnkiConnectionHelpPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

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

  async function copyOrigin() {
    try {
      await navigator.clipboard.writeText(window.location.origin)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return createPortal(
    <div className="anki-connection-help">
      <AlertTriangle size={19} />
      <div>
        <strong>Anki открыт, но браузер пока не получил ответ от AnkiConnect.</strong>
        <p>Это уже не похоже на проблему с перезапуском. Michi теперь пробует и <code>127.0.0.1:8765</code>, и <code>localhost:8765</code>, использует loopback-доступ Chrome и отправляет первый запрос без лишнего CORS-preflight.</p>
        <p>Если ошибка останется, открой <b>Инструменты → Дополнения → AnkiConnect → Конфигурация</b>. В <code>webCorsOriginList</code> добавь <code>{window.location.origin}</code>. Если этот адрес есть в <code>ignoreOriginList</code>, удали его оттуда. Порт должен быть <code>8765</code>, адрес — <code>127.0.0.1</code>.</p>
        <p>После сохранения конфигурации перезапусти только Anki. Это ручной запасной путь на случай, если Chrome не пропускает автоматический <code>requestPermission</code>.</p>
        <div className="anki-help-actions">
          <button type="button" className="secondary-button" onClick={retry}><RefreshCw size={16} /> Проверить снова</button>
          <button type="button" className="secondary-button" onClick={() => void copyOrigin()}><Copy size={16} /> {copied ? 'Скопировано' : 'Скопировать адрес Michi'}</button>
        </div>
      </div>
    </div>,
    target,
  )
}
