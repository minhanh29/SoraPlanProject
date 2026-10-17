// Floating chip above the selected item (rendered through drei <Html>, so props only — no app context).
import { Icon } from "../../components/ui";
import { formatDims, formatLength } from "../../lib/units";
import type { ItemInstance, PlanUnits } from "../../lib/types";

interface Props {
  item: ItemInstance;
  name: string;
  units: PlanUnits;
  warning: string | null;
  wallGap: number | null;
  dragging: boolean;
  /** Corner / side / height handle in use: show the live size. */
  resizing?: boolean;
  onReplace: () => void;
  onDelete: () => void;
}

export default function SelectionChip({ item, name, units, warning, wallGap, dragging, resizing, onReplace, onDelete }: Props) {
  if (dragging) {
    return (
      <div className={`s3d-chip s3d-chip--live ${warning ? "is-warn" : ""}`}>
        {resizing && <span>{formatDims(item.dims, units)}</span>}
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
      <button className="icon-btn s3d-chip__btn" onClick={onReplace} title="Replace model" aria-label="Replace model">
        <Icon name="swap" size={16} />
      </button>
      <button className="icon-btn s3d-chip__btn s3d-chip__btn--danger" onClick={onDelete} title="Delete (Del)" aria-label="Delete item">
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}
