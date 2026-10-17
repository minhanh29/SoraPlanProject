// Snapshot undo/redo. The first snapshot is the baseline and can never be undone past.
export class History<T> {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  reset(state: T) {
    this.undoStack = [JSON.stringify(state)];
    this.redoStack = [];
  }

  push(state: T) {
    const snap = JSON.stringify(state);
    if (this.undoStack[this.undoStack.length - 1] === snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 1;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.redoStack.push(this.undoStack.pop()!);
    return JSON.parse(this.undoStack[this.undoStack.length - 1]);
  }

  redo(): T | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(next);
    return JSON.parse(next);
  }
}
