import * as React from "react";
import { cn } from "../../lib/utils";

type CardProps = React.HTMLAttributes<HTMLDivElement>;

export default function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-soft",
        "backdrop-blur-sm transition-colors duration-200",
        "dark:bg-card/95",
        className
      )}
      {...props}
    />
  );
}