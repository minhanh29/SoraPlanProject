// Floating chip above the selected item (rendered through drei <Html>, so props only — no app context).
import { Menu } from "../../components/ui";
import { formatDims, formatLength } from "../../lib/units";
import type { ItemInstance, PlanUnits } from "../../lib/types";

interface Props {
  item: ItemInstance;
  name: string;
  units: PlanUnits;
  warning: string | null;
  wallGap: number | null;
  dragging: boolean;
  onReplace: () => void;
  onDelete: () => void;
}

export default function SelectionChip({ item, name, units, warning, wallGap, dragging, onReplace, onDelete }: Props) {
  if (dragging) {
    return (
      <div className={`s3d-chip s3d-chip--live ${warning ? "is-warn" : ""}`}>
        {wallGap !== null && <span>{wallGap <= 0 ? "Touching wall" : `${formatLength(wallGap, units)} to wall`}</span>}
        {warning && <span className="s3d-chip__warn">{warning}</span>}
      </div>
    );
  }
  return (
    <div className={`s3d-chip ${warning ? "is-warn" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="s3d-chip__text">
        <strong>{name}</strong>
        <span>{formatDims(item.dims, units)}</span>
        {warning && <span className="s3d-chip__warn">{warning}</span>}
      </div>
      <Menu
        label="Item actions"
        items={[
          { label: "Replace…", onClick: onReplace },
          { label: "Delete", onClick: onDelete, danger: true },
        ]}
      />
    </div>
  );
}
