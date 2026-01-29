import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { CATEProvider } from './lib/CATEContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CATEProvider>
      <App />
    </CATEProvider>
  </React.StrictMode>,
)
