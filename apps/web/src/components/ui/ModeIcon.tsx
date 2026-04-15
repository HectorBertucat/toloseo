import { type Component } from "solid-js";
import type { TransitMode } from "@shared/types";

interface ModeIconProps {
  mode: TransitMode;
  size?: number;
}

const MODE_SYMBOLS: Record<TransitMode, string> = {
  metro: "\u24C2",
  tram: "\u{1F68B}",
  bus: "\u{1F68C}",
  cable: "\u{1F6A0}",
};

const MODE_COLORS: Record<TransitMode, string> = {
  metro: "#e3004f",
  tram: "#00a651",
  bus: "#0075bf",
  cable: "#8b5cf6",
};

const ModeIcon: Component<ModeIconProps> = (props) => {
  const size = () => props.size ?? 20;

  return (
    <span
      class="mode-icon"
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        width: `${size()}px`,
        height: `${size()}px`,
        "font-size": `${size() * 0.7}px`,
        color: MODE_COLORS[props.mode],
      }}
      aria-label={props.mode}
      role="img"
    >
      {MODE_SYMBOLS[props.mode]}
    </span>
  );
};

export default ModeIcon;
