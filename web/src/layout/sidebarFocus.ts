// Workspace focus: while a page shows its canvas, the shell collapses the sidebar to give it the room.
import { createContext, useContext, useEffect } from "react";

export const SidebarFocusContext = createContext<(focused: boolean) => void>(() => undefined);

/** Collapse the sidebar while `focused` (the user's saved sidebar preference comes back afterwards). */
export function useSidebarFocus(focused: boolean) {
  const setFocus = useContext(SidebarFocusContext);
  useEffect(() => {
    setFocus(focused);
    return () => setFocus(false);
  }, [focused, setFocus]);
}
