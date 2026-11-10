import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './telegram.js' // a Telegram Mini App launch: SDK, theme, BackButton, startapp route; nothing in a browser
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
