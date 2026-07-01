import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./Button";

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20">
        <AlertTriangle size={26} />
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      {message && <p className="mt-2 max-w-sm text-sm text-neutral-500 break-words">{message}</p>}
      {onRetry && (
        <Button variant="glass" onClick={onRetry} className="mt-5">
          <RotateCw size={15} /> Try again
        </Button>
      )}
    </div>
  );
}
