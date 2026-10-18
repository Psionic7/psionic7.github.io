import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './workspace.css';
import './ux.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

import './explore.css';
import './transactions/transaction-density.css';
