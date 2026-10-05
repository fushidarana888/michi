import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './AppV2'
import { AnkiConnectionHelpPortal } from './components/AnkiConnectionHelpPortal'
import { AnkiDifficultyListPortal } from './components/AnkiDifficultyListPortal'
import { AnkiIntegrationPortal } from './components/AnkiIntegrationPortal'
import { AnkiStudyRefreshPortal } from './components/AnkiStudyRefreshPortal'
import { CardsAnalyticsPortal } from './components/CardsAnalyticsPortal'
import { RouteSelectionPortal } from './components/RouteSelectionPortal'
import { StudyPartSelectorPortal } from './components/StudyPartSelectorPortal'
import { installLoopbackFetchSupport } from './lib/loopbackFetch'
import './styles.css'

installLoopbackFetchSupport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
      <StudyPartSelectorPortal />
      <RouteSelectionPortal />
      <AnkiIntegrationPortal />
      <AnkiDifficultyListPortal />
      <AnkiConnectionHelpPortal />
      <AnkiStudyRefreshPortal />
      <CardsAnalyticsPortal />
    </HashRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js')
      .then((registration) => registration.update())
      .catch(() => undefined)
  })
}
