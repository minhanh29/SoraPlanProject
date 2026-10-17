import { useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { useConversations } from "../hooks/useConversations";
import { api } from "../lib/api";
import { relativeTime } from "../lib/units";
import type { Conversation } from "../lib/types";
import { ConfirmDialog, Icon, Menu, toast } from "../components/ui";

function Row({ c, onNavigate }: { c: Conversation; onNavigate: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(c.title);
  const [confirm, setConfirm] = useState(false);
  const navigate = useNavigate();
  const { projectId } = useParams();

  const saveTitle = async () => {
    setRenaming(false);
    const t = title.trim();
    if (!t || t === c.title) return setTitle(c.title);
    try {
      await api.updateConversation(c.id, { title: t });
    } catch (e: any) {
      toast(e.message || "Rename failed", "error");
      setTitle(c.title);
    }
  };

  return (
    <li className="proj-row">
      {renaming ? (
        <input
          className="input proj-row__rename"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveTitle();
            if (e.key === "Escape") {
              setTitle(c.title);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <NavLink to={`/p/${c.id}`} className="proj-row__link" onClick={onNavigate} title={c.title}>
          <span className={`proj-row__thumb ${c.thumbnailKind === "scene" ? "is-scene" : "is-plan"}`}>
            {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" loading="lazy" /> : <Icon name="grid" size={14} />}
          </span>
          <span className="proj-row__title">{c.title}</span>
          <span className="proj-row__time">{c.busy ? <span className="dot-pulse" /> : relativeTime(c.updatedAt)}</span>
        </NavLink>
      )}
      <Menu
        className="proj-row__menu"
        items={[
          { label: "Rename", onClick: () => setRenaming(true) },
          { label: "Delete", danger: true, onClick: () => setConfirm(true) },
        ]}
      />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete project?"
        message={<>“{c.title}”, its chat, plan and 3D scene will be deleted. This can't be undone.</>}
        onConfirm={async () => {
          await api.deleteConversation(c.id);
          if (projectId === c.id) navigate("/");
          toast("Project deleted");
        }}
      />
    </li>
  );
}

export default function ProjectList({ onNavigate }: { onNavigate: () => void }) {
  const convs = useConversations();
  if (convs === undefined)
    return (
      <ul className="proj-list">
        {[0, 1, 2].map((i) => <li key={i} className="proj-row proj-row--skeleton" />)}
      </ul>
    );
  if (!convs.length)
    return (
      <div className="proj-empty subtle">
        <img src="/art/obj-plans.webp" alt="" width={88} height={88} />
        Your projects will show up here.
      </div>
    );
  return (
    <ul className="proj-list">
      {convs.map((c) => <Row key={c.id} c={c} onNavigate={onNavigate} />)}
    </ul>
  );
}
