"use client";

import { ReactNode, useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T = any> {
  key: string;
  header: string | ReactNode;
  render?: (row: T, index: number) => ReactNode;
  accessor?: keyof T | string;
  width?: string;
  align?: "left" | "center" | "right";
  className?: string;
}

export interface DataTableProps<T = any> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  emptyText?: string;
  rowKey?: (row: T) => string | number;
  zebra?: boolean;
  className?: string;
}

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr>
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-100 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T>({
  columns,
  data,
  loading,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  emptyText = "暂无数据",
  rowKey,
  zebra = true,
  className,
}: DataTableProps<T>) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const pageNumbers = useMemo(() => {
    const pages: (number | string)[] = [];
    const max = totalPages;
    const cur = safePage;
    const range = 2;
    const set = new Set<number>();
    for (let i = 1; i <= Math.min(2, max); i++) set.add(i);
    for (let i = Math.max(1, cur - range); i <= Math.min(max, cur + range); i++)
      set.add(i);
    for (let i = Math.max(1, max - 1); i <= max; i++) set.add(i);
    const sorted = [...set].sort((a, b) => a - b);
    let prev = 0;
    for (const p of sorted) {
      if (prev && p - prev > 1) pages.push("...");
      pages.push(p);
      prev = p;
    }
    return pages;
  }, [safePage, totalPages]);

  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-cyan-100 shadow-sm overflow-hidden",
        className
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-cyan-100">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    "px-4 py-3 text-left font-semibold text-teal-700 whitespace-nowrap",
                    col.align === "center" && "text-center",
                    col.align === "right" && "text-right",
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
                <SkeletonRow key={i} colCount={columns.length} />
              ))
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-16 text-center text-gray-400"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              data.map((row, i) => {
                const key = rowKey
                  ? rowKey(row)
                  : (row as any)?.id ?? (row as any)?.ticketNo ?? i;
                return (
                  <tr
                    key={String(key)}
                    className={cn(
                      "transition-colors hover:bg-teal-50/40",
                      zebra && i % 2 === 1 && "bg-gray-50/50"
                    )}
                  >
                    {columns.map((col) => {
                      const val = col.accessor
                        ? (row as any)[col.accessor as string]
                        : undefined;
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            "px-4 py-3 text-gray-700 align-middle",
                            col.align === "center" && "text-center",
                            col.align === "right" && "text-right",
                            col.className
                          )}
                        >
                          {col.render ? col.render(row, i) : val ?? "-"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>
            共 <b className="text-gray-700">{total}</b> 条
          </span>
          {onPageSizeChange && (
            <div className="flex items-center gap-1.5">
              <span>每页</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  onPageSizeChange?.(Number(e.target.value));
                  onPageChange(1);
                }}
                className="border border-gray-200 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {pageSizeOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span>条</span>
            </div>
          )}
          {loading && (
            <span className="inline-flex items-center gap-1 text-teal-600">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              加载中
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(1)}
            disabled={safePage <= 1 || loading}
            className="p-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-white hover:text-teal-600 disabled:opacity-40 disabled:cursor-not-allowed"
            title="首页"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage <= 1 || loading}
            className="p-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-white hover:text-teal-600 disabled:opacity-40 disabled:cursor-not-allowed"
            title="上一页"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {pageNumbers.map((p, i) =>
            typeof p === "number" ? (
              <button
                key={i}
                onClick={() => onPageChange(p)}
                disabled={loading}
                className={cn(
                  "min-w-[32px] px-2 py-1.5 rounded-md border text-sm font-medium transition-colors",
                  p === safePage
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "border-gray-200 text-gray-600 hover:bg-white hover:text-teal-600"
                )}
              >
                {p}
              </button>
            ) : (
              <span key={i} className="px-1 text-gray-400">
                {p}
              </span>
            )
          )}

          <button
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages || loading}
            className="p-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-white hover:text-teal-600 disabled:opacity-40 disabled:cursor-not-allowed"
            title="下一页"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={safePage >= totalPages || loading}
            className="p-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-white hover:text-teal-600 disabled:opacity-40 disabled:cursor-not-allowed"
            title="末页"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
