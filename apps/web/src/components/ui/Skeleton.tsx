import { type Component } from "solid-js";

interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
}

const Skeleton: Component<SkeletonProps> = (props) => {
  return (
    <div
      class="skeleton"
      style={{
        width: props.width ?? "100%",
        height: props.height ?? "20px",
        "border-radius": props.borderRadius ?? "var(--radius-md)",
        background: `linear-gradient(
          90deg,
          var(--color-bg-tertiary) 25%,
          var(--color-bg-elevated) 50%,
          var(--color-bg-tertiary) 75%
        )`,
        "background-size": "200% 100%",
        animation: "skeleton-shimmer 1.5s ease-in-out infinite",
      }}
      aria-hidden="true"
    />
  );
};

export default Skeleton;
