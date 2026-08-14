import type {
  PaneSnapshot,
  ResourceSnapshot,
  ScreenSnapshot,
  TabSnapshot,
  TerminalSnapshot,
  WorkspaceSnapshot,
} from "cmux-sdk/browser";

export interface PaneModel extends PaneSnapshot {
  readonly tabs: readonly TabSnapshot[];
  readonly activeTab?: TabSnapshot;
  readonly terminal?: TerminalSnapshot;
}

export interface ScreenModel extends ScreenSnapshot {
  readonly panes: readonly PaneModel[];
}

export interface WorkspaceModel extends WorkspaceSnapshot {
  readonly screens: readonly ScreenModel[];
}

export function projectSnapshot(snapshot: ResourceSnapshot): readonly WorkspaceModel[] {
  return [...snapshot.workspaces]
    .sort((left, right) => left.index - right.index)
    .map((workspace) => ({
      ...workspace,
      screens: snapshot.screens
        .filter((screen) => screen.workspaceId === workspace.id)
        .sort((left, right) => left.index - right.index)
        .map((screen) => ({
          ...screen,
          panes: snapshot.panes
            .filter((pane) => pane.screenId === screen.id)
            .map((pane) => {
              const tabs = snapshot.tabs
                .filter((tab) => tab.paneId === pane.id)
                .sort((left, right) => left.index - right.index);
              const activeTab = tabs.find((tab) => tab.focused) ?? tabs[0];
              const terminal = activeTab?.contentKind === "terminal"
                ? snapshot.terminals.find((item) => item.id === activeTab.contentId)
                : undefined;
              return { ...pane, tabs, activeTab, terminal };
            }),
        })),
    }));
}
