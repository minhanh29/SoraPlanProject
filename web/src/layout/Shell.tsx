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

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

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
