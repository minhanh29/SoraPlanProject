import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Icon } from "../components/ui";
import ProjectList from "./ProjectList";
import ThemeToggle from "./ThemeToggle";

export default function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const name = profile?.displayName || user?.displayName || user?.email || "You";
  const photo = profile?.photoUrl || user?.photoURL;

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar__head">
        <button className="sidebar__logo" onClick={() => { navigate("/"); onNavigate(); }} aria-label="SoraPlan home">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          {!collapsed && <span>SoraPlan</span>}
        </button>
        <button className="icon-btn sidebar__collapse" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Icon name="sidebar" />
        </button>
      </div>

      <button className="btn btn--primary sidebar__new" onClick={() => { navigate("/"); onNavigate(); }} title="New project">
        <Icon name="plus" />
        {!collapsed && <span>New project</span>}
      </button>

      <NavLink to="/assets/system" className={({ isActive }) => `side-btn ${isActive ? "is-active" : ""}`} onClick={onNavigate} title="Assets">
        <Icon name="cube" />
        {!collapsed && <span>Assets</span>}
      </NavLink>

      {!collapsed && (
        <>
          <div className="sidebar__label">Projects</div>
          <div className="sidebar__projects">
            <ProjectList onNavigate={onNavigate} />
          </div>
        </>
      )}
      {collapsed && <div className="sidebar__spacer" />}

      <div className="sidebar__foot">
        <ThemeToggle compact={collapsed} />
        <div className="sidebar__user" title={user?.email || ""}>
          {photo ? <img src={photo} alt="" className="avatar" referrerPolicy="no-referrer" /> : <span className="avatar">{name[0]?.toUpperCase()}</span>}
          {!collapsed && <span className="sidebar__name">{name}</span>}
          <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
