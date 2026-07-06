import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppLayout } from "@/components/ui/AppLayout";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "运单全流程管理系统 V3",
  description: "运单全生命周期管理 - 异常上报、审批、品控、赔付联动、同步监控",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <AppLayout>{children}</AppLayout>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
