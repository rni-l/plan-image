import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:     "bg-zinc-900 text-white",
        secondary:   "bg-zinc-100 text-zinc-700",
        outline:     "border border-zinc-200 text-zinc-700",
        running:     "bg-blue-50   text-blue-700",
        succeeded:   "bg-green-50  text-green-700",
        failed:      "bg-red-50    text-red-700",
        queued:      "bg-zinc-100  text-zinc-500",
        interrupted: "bg-amber-50  text-amber-700",
      },
    },
    defaultVariants: { variant: "secondary" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
