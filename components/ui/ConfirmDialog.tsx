"use client";

import { ReactNode, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger" | "warning" | "success";
  requireNote?: boolean;
  noteLabel?: string;
  notePlaceholder?: string;
  onConfirm: (note?: string) => Promise<void> | void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  variant = "default",
  requireNote = false,
  noteLabel = "备注",
  notePlaceholder = "请输入备注说明...",
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const variantStyles = {
    default: {
      icon: "text-teal-600 bg-teal-50",
      btn: "bg-primary hover:bg-primaryDark",
    },
    danger: {
      icon: "text-red-600 bg-red-50",
      btn: "bg-red-600 hover:bg-red-700",
    },
    warning: {
      icon: "text-orange-600 bg-orange-50",
      btn: "bg-orange-600 hover:bg-orange-700",
    },
    success: {
      icon: "text-green-600 bg-green-50",
      btn: "bg-green-600 hover:bg-green-700",
    },
  }[variant];

  const handleConfirm = async () => {
    if (requireNote && !note.trim()) {
      toast.error("请填写备注说明");
      return;
    }
    setLoading(true);
    try {
      await onConfirm(requireNote ? note.trim() : undefined);
      onOpenChange(false);
      setNote("");
    } catch (e: any) {
      toast.error(e.message ?? "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => !loading && onOpenChange(false)}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-cyan-100 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start gap-4 px-6 pt-6">
          <div
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
              variantStyles.icon
            )}
          >
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900 pr-8">{title}</h3>
            {description && (
              <div className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">
                {description}
              </div>
            )}
          </div>
          <button
            onClick={() => !loading && onOpenChange(false)}
            disabled={loading}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {children && <div className="px-6 pt-4">{children}</div>}

        {requireNote && (
          <div className="px-6 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {noteLabel}
              <span className="text-red-500 ml-0.5">*</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={notePlaceholder}
              disabled={loading}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none disabled:opacity-60"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-6 py-5 mt-4 bg-gray-50/50 border-t border-gray-100">
          <button
            onClick={() => !loading && onOpenChange(false)}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={cn(
              "px-5 py-2.5 rounded-lg text-sm font-medium text-white shadow-sm disabled:opacity-60 flex items-center gap-2",
              variantStyles.btn
            )}
          >
            {loading && (
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
