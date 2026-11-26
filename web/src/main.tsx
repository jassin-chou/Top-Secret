import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/huninn'; // 粉圓體（justfont 開源圓體），跟著網站一起部署，不依賴 Google Fonts
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
