import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px]
            data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200"
        />
        <DialogPrimitive.Popup
          className={cn(
            "fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col bg-white shadow-xl",
            "data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full",
            "transition-transform duration-200",
            className
          )}
        >
          {/* Header */}
          {title && (
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
              <DialogPrimitive.Title className="text-sm font-semibold text-zinc-900">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                render={
                  <button className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
                    <X size={16} />
                  </button>
                }
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
