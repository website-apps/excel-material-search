import { KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type ArchiveFilterOption = { value: string; label: string; count: number };

export default function ArchiveFilter(props: {
  label: string;
  icon: ReactNode;
  value: string;
  options: ArchiveFilterOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selectedIndex = Math.max(0, props.options.findIndex((option) => option.value === props.value));
  const selected = props.options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function choose(index: number) {
    props.onChange(props.options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? props.options.length - 1
        : !open ? selectedIndex : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + props.options.length) % props.options.length;
      setActiveIndex(next);
      setOpen(true);
    } else if (open && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key.length === 1 && event.key.trim()) {
      const index = props.options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (index >= 0) { setActiveIndex(index); setOpen(true); }
    }
  }

  return (
    <div className={`archive-filter${props.value ? " is-selected" : ""}`} ref={root}>
      <button ref={trigger} type="button" role="combobox" aria-label={props.label}
        aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? menuId : undefined}
        aria-activedescendant={open ? `${menuId}-${activeIndex}` : undefined}
        className="archive-filter-trigger" onKeyDown={handleKey}
        onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node)) setOpen(false); }}
        onClick={() => { setActiveIndex(selectedIndex); setOpen((value) => !value); }}>
        {props.icon}<span>{selected?.label}</span><ChevronDown size={15} aria-hidden="true" className={open ? "is-open" : ""} />
      </button>
      {open ? (
        <div className="archive-filter-menu">
          <div className="archive-filter-menu-title">{props.label}<span>文件数</span></div>
          <div id={menuId} role="listbox" aria-label={props.label} className="archive-filter-options">
            {props.options.map((option, index) => (
              <div key={option.value} id={`${menuId}-${index}`} role="option"
                aria-selected={option.value === props.value} aria-label={option.label}
                className={`archive-filter-option${index === activeIndex ? " is-active" : ""}`}
                onPointerMove={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}>
                <span>{option.label}</span><small>{option.count}</small>
                <Check size={14} aria-hidden="true" className={option.value === props.value ? "" : "is-hidden"} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
