import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserAgent } from './BrowserAgent';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserAgent />
  </React.StrictMode>
);

