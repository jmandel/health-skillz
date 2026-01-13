import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ConnectPage from './pages/ConnectPage';
import ProviderSelectPage from './pages/ProviderSelectPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import './index.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/connect/:sessionId" element={<ConnectPage />} />
        <Route path="/connect/:sessionId/select" element={<ProviderSelectPage />} />
        <Route path="/connect/:sessionId/callback" element={<OAuthCallbackPage />} />
        <Route path="/connect/callback" element={<OAuthCallbackPage />} />
      </Routes>
    </BrowserRouter>
  );
}
