export function DashboardHeader({ health, stations, weatherStations, riverStations, alertCount, mobileView, setMobileView }) {
  return (
    <>
    <header className="topbar">
      <a className="brand" href="/"><span className="brand-mark">R</span><span><strong>RiverCast</strong><small>OBSERVATION & FORECAST CONSOLE</small></span></a>
      <div className="topbar-center"><span className="live-dot" /> GLOBAL MONITORING <span className="topbar-divider">/</span> HYDROLOGY WORKSPACE</div>
      <div className="topbar-right"><span className="service-state"><i /> {health?.status === 'ok' ? 'Systems operational' : 'Connecting'}</span><a className="docs-link" href="/docs" target="_blank">API docs ↗</a></div>
    </header>
    <section className="command-strip" aria-label="Network status">
      <div className="command-title"><span className="command-kicker">OPERATIONS / LIVE NETWORK</span><strong>Earth observation workspace</strong></div>
      <div className="command-metrics"><div><span>MONITORING SITES</span><b>{stations.length.toString().padStart(2, '0')}</b></div><div><span>LIVE WEATHER</span><b>{weatherStations.length.toString().padStart(2, '0')}</b></div><div><span>RIVER GAUGES</span><b>{riverStations.length.toString().padStart(2, '0')}</b></div><div className={alertCount ? 'metric-alert' : ''}><span>ACTIVE ALERTS</span><b>{alertCount.toString().padStart(2, '0')}</b></div></div>
      <div className="command-updated"><i className="live-dot" /><span>NETWORK STATUS</span><b>{health?.status === 'ok' ? 'Operational' : 'Connecting'}</b></div>
    </section>
    <nav className="mobile-workspace-tabs" aria-label="Workspace views">{[['map', 'Map'], ['feeds', 'Feeds'], ['site', 'Site']].map(([key, label]) => <button type="button" key={key} className={mobileView === key ? 'active' : ''} aria-pressed={mobileView === key} onClick={() => setMobileView(key)}>{label}</button>)}</nav>
    </>
  );
}

export function DashboardFooter({ health, token, saveToken, message, error, setMessage, setError }) {
  return (
    <>
    <footer className="bottom-bar"><div>RIVERCAST <span>·</span> LOCAL FORECASTING PLATFORM</div><div><label>Write token <input aria-label="API write token" type="password" value={token} onChange={(event) => saveToken(event.target.value)} placeholder={health?.write_auth_enabled ? 'Required for edits' : 'Optional'} /></label><span className="footer-divider" /> <span>PostGIS</span><span className="footer-dot" /><span>MinIO</span><span className="footer-dot" /><span>FastAPI</span></div></footer>
    {(message || error) && <div className={`toast ${error ? 'toast-error' : ''}`} role="status"><span>{error ? '!' : '✓'}</span>{error || message}<button onClick={() => { setError(''); setMessage(''); }}>×</button></div>}
    </>
  );
}
