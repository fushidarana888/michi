import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './AppV2'
import { AnkiIntegrationPortal } from './components/AnkiIntegrationPortal'
import { RouteSelectionPortal } from './components/RouteSelectionPortal'
import { StudyPartSelectorPortal } from './components/StudyPartSelectorPortal'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
      <StudyPartSelectorPortal />
      <RouteSelectionPortal />
      <AnkiIntegrationPortal />
    </HashRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => undefined)
  })
}
