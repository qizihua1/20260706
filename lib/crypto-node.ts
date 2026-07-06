// 服务端专用加密工具（依赖 Node.js 内置 crypto 模块）
// 注意：不要在客户端组件或客户端共享库中导入本文件，否则打包时会因 node:crypto 缺失而报错
import crypto from "node:crypto";

export function sha256HexSync(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
