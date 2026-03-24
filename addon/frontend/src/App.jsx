import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Activity, Monitor, ListVideo, Image as ImageIcon, LayoutDashboard, ServerCog } from 'lucide-react';
import ScreensPage from './pages/ScreensPage';
import PlaylistsPage from './pages/PlaylistsPage';
import MediaPage from './pages/MediaPage';
import PlayerPage from './pages/PlayerPage/PlayerPage';
import LayoutsPage from './pages/LayoutsPage';
import LayoutEditorPage from './pages/LayoutEditorPage';
import MonitoringPage from './pages/MonitoringPage';
import ProvisioningPage from './pages/ProvisioningPage';
import './App.css';

function App() {
  const location = useLocation();

  // Hide sidebar if we are on the player screen
  const isPlayer = location.pathname.startsWith('/player');

  const navItems = [
    { path: '/', label: 'Screens', icon: Monitor },
    { path: '/playlists', label: 'Playlisten', icon: ListVideo },
    { path: '/layouts', label: 'Layouts', icon: LayoutDashboard },
    { path: '/media', label: 'Medien', icon: ImageIcon },
    { path: '/provisioning', label: 'Provisioning', icon: ServerCog },
    { path: '/monitoring', label: 'Monitoring', icon: Activity },
  ];

  if (isPlayer) {
    return (
      <Routes>
        <Route path="/player" element={<PlayerPage />} />
      </Routes>
    );
  }

  return (
    <div className="layout">
      {/* Modern Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Signage OS</h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>v2.1.0</p>
        </div>
        <nav>
          <ul className="nav-list">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path} className={isActive ? 'active' : ''}>
                  <Link to={item.path}>
                    <Icon size={20} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<ScreensPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/layouts" element={<LayoutsPage />} />
          <Route path="/layouts/:id/edit" element={<LayoutEditorPage />} />
          <Route path="/media" element={<MediaPage />} />
          <Route path="/provisioning" element={<ProvisioningPage />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
