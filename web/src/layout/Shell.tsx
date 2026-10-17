import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import { Icon } from "../components/ui";
import "./layout.css";

const KEY = "soraplan.sidebar";

export default function Shell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  useEffect(() => setDrawer(false), [location.pathname]);

  const setAndStore = (next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "collapsed" : "open");
    } catch {
      /* ignore */
    }
    setCollapsed(next);
  };

  const toggle = () => setAndStore(!collapsed);

  // Creating a project collapses the sidebar to give the workspace more room
  const collapseRequested = (location.state as { collapseSidebar?: boolean } | null)?.collapseSidebar;
  useEffect(() => {
    if (collapseRequested) setAndStore(true);
  }, [location.key, collapseRequested]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`shell ${collapsed ? "shell--collapsed" : ""} ${drawer ? "shell--drawer" : ""}`}>
      <Sidebar collapsed={collapsed && !drawer} onToggle={drawer ? () => setDrawer(false) : toggle} onNavigate={() => setDrawer(false)} />
      <div className="shell__scrim" onClick={() => setDrawer(false)} />
      <main className="shell__main">
        <button className="icon-btn shell__menu" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Icon name="menu" />
        </button>
        <Outlet />
      </main>
    </div>
  );
}
