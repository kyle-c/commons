import Icon from "./icons";
import type { ProjectTab } from "../lib/tabs";

/**
 * The open-project tab strip, shared by the home and project titlebars.
 * Home is a pinned icon tab; "+" returns to the grid where creation lives.
 * Cycle with ⌃Tab / ⌃⇧Tab or ⌘⇧[ / ⌘⇧].
 */
export default function TabBar({
  tabs,
  active,
  onSelect,
  onClose,
}: {
  tabs: ProjectTab[];
  active: string; // "home" | projectId
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="tab-strip">
      <button
        className={`tab tab-home ${active === "home" ? "active" : ""}`}
        aria-label="Home"
        title="Home"
        onClick={(e) => {
          e.currentTarget.blur(); // focus styling must not linger across screens
          onSelect("home");
        }}
      >
        <Icon name="home" size={15} />
      </button>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${active === tab.id ? "active" : ""}`}
          title={tab.name}
          onClick={(e) => {
            e.currentTarget.blur();
            onSelect(tab.id);
          }}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(tab.id);
          }}
        >
          <span className="tab-name">{tab.name}</span>
          <span
            className="tab-x"
            role="button"
            aria-label={`Close ${tab.name}`}
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            ✕
          </span>
        </button>
      ))}
      {tabs.length > 0 && active !== "home" && (
        <button
          className="tab tab-add"
          aria-label="New tab"
          title="Open another project"
          onClick={(e) => {
            e.currentTarget.blur();
            onSelect("home");
          }}
        >
          +
        </button>
      )}
    </div>
  );
}
