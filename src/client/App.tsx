import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ConnectPage from './pages/ConnectPage';
import ProviderSelectPage from './pages/ProviderSelectPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import CollectPage from './pages/CollectPage';
import CollectProviderSelectPage from './pages/CollectProviderSelectPage';
import CollectCallbackPage from './pages/CollectCallbackPage';
import './index.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        
        {/* Agent-initiated flow (with server session) */}
        <Route path="/connect/:sessionId" element={<ConnectPage />} />
        <Route path="/connect/:sessionId/select" element={<ProviderSelectPage />} />
        <Route path="/connect/:sessionId/callback" element={<OAuthCallbackPage />} />
        <Route path="/connect/callback" element={<OAuthCallbackPage />} />
        
        {/* Self-service collection flow (local only) */}
        <Route path="/collect" element={<CollectPage />} />
        <Route path="/collect/select" element={<CollectProviderSelectPage />} />
        <Route path="/collect/callback" element={<CollectCallbackPage />} />
      </Routes>
    </BrowserRouter>
  );
}
