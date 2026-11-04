import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './design-system/tokens.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root nao encontrado.');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
