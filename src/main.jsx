import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import OnboardingWebsite from './portal/OnboardingWebsite';
import './styles/workspace-palette.css';

// Old preview URLs now lead to the current website sections.
const path = window.location.pathname;
if (path === '/guide' || path.startsWith('/guide/')) window.history.replaceState({}, '', '/mira');
if (['/chat', '/avatar-preview', '/about', '/resources'].includes(path))
  window.history.replaceState({}, '', '/mira');
createRoot(document.getElementById('root')).render(<OnboardingWebsite />);
