import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { desktop } from './desktopApi'

// Installed desktop app (licence, Google account, data in the customer's own Drive) or web app (cloud sign-in):
// each loads only its own code, so the desktop never downloads or parses the web app and its Firebase client.
const view = desktop
  ? import('./DesktopApp').then(({ DesktopApp }) => <DesktopApp api={desktop!} />)
  : import('./App.tsx').then(({ default: App }) => <App />)

void view.then((node) => createRoot(document.getElementById('root')!).render(<StrictMode>{node}</StrictMode>))
