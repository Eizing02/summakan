import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-sans-thai/thai-500.css';
import '@fontsource/noto-sans-thai/thai-700.css';
import '@fontsource/noto-sans-thai/latin-400.css';
import '@fontsource/noto-sans-thai/latin-700.css';
import 'katex/dist/katex.min.css';
import './styles/app.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(<App/>);
