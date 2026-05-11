// src/main.tsx
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
import './index.css';
import { startKeepAwakeManager } from '@/services/keep-awake-manager';

// Configure Monaco Environment before app starts
// TypeScript worker is removed to reduce bundle size (~6MB)
window.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

// Use StrictMode only in development to help detect issues
// In production, avoid double-invocation of effects for better performance
const isDevelopment = import.meta.env.DEV;

startKeepAwakeManager();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  isDevelopment ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : (
    <App />
  )
);
