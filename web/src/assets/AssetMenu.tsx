import { Menu } from "../components/ui";

export default function AssetMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <Menu
      label="Asset actions"
      className="asset-menu"
      items={[
        { label: "Edit", onClick: onEdit },
        { label: "Delete", onClick: onDelete, danger: true },
      ]}
    />
  );
}
