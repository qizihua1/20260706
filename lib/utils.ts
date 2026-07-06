import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(
  amount: number | string | null | undefined,
  currency: string = "CNY"
): string {
  if (amount === null || amount === undefined) return "-";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatDate(
  date: Date | string | null | undefined,
  withTime: boolean = true
): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  const dateStr = d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  if (!withTime) return dateStr;
  const timeStr = d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${dateStr} ${timeStr}`;
}

export function generateTicketNo(date?: Date, seq: number = 1): string {
  const d = date ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const seqStr = String(seq).padStart(4, "0");
  return `T${y}${m}${day}-${seqStr}`;
}

export async function sha256Hex(input: string): Promise<string> {
  // 使用 Web Crypto API（globalThis.crypto）——浏览器与 Node.js 18+ 均可使用，无 node:crypto 依赖
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 同步 SHA-256 已迁移到 lib/crypto-node.ts（仅服务端可用，避免客户端打包时引入 node:crypto）
// 如需服务端同步哈希，请导入：import { sha256HexSync } from "@/lib/crypto-node"

export function requestId(): string {
  // globalThis.crypto.randomUUID() 兼容浏览器和 Node.js 19+
  return globalThis.crypto.randomUUID();
}

