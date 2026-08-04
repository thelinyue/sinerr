/**
 * 服务端依赖追踪（Sinerr 2.0 横切 · 镜像瘦身方案 2）
 *
 * 用 @vercel/nft 追踪自定义服务端入口 dist/index.js 的运行时依赖，
 * 组装 `runtime-stage/`（保留 pnpm 布局 + 原生模块 allowlist + fs 读取文件），
 * 供 Docker runtime 阶段只拷贝所需文件，削减 node_modules 体积。
 *
 * 运行时还需额外拷贝：.next / public / sinerr-api.yml（见 Dockerfile）。
 */
import { nodeFileTrace } from '@vercel/nft';
import fs from 'node:fs';
import path from 'node:path';

const base = process.cwd();
const stage = path.join(base, '.runtime-stage');
const entry = 'dist/index.js';

if (!fs.existsSync(entry)) {
  console.error('dist/index.js not found. Run pnpm build first.');
  process.exit(1);
}

console.log('Tracing dependencies of', entry);

const { fileList } = await nodeFileTrace([entry], {
  base,
  processCwd: base,
});

const rels = new Set(
  [...fileList].map((f) => path.relative(base, f).replace(/\\/g, '/'))
);
console.log(`Traced ${rels.size} files`);

// 清理并重建 stage
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// 1. 复制被追踪的真实文件（保留相对路径，含 .pnpm store 布局；跳过 symlink/目录）
let copied = 0;
for (const rel of rels) {
  const src = path.join(base, rel);
  let st;
  try {
    st = fs.lstatSync(src);
  } catch {
    continue;
  }
  if (!st.isFile()) continue; // symlink / 目录由第 2、3 步处理
  const dest = path.join(stage, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied++;
}

// 2. 重建 node_modules 顶层 symlink（pnpm 布局）
// 直接复用原始相对 target（stage 保留相同 .pnpm 相对布局，可正确解析）
const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
function walkSymlinks(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const relLink = path.relative(base, p).replace(/\\/g, '/');
      if (!relLink.includes('node_modules')) continue;
      const destLink = path.join(stage, relLink);
      fs.mkdirSync(path.dirname(destLink), { recursive: true });
      if (!fs.existsSync(destLink)) {
        try {
          fs.symlinkSync(fs.readlinkSync(p), destLink, symlinkType);
        } catch {
          // 权限/平台限制下忽略（target 真实文件已复制）
        }
      }
    } else if (entry.isDirectory() && p.includes('node_modules')) {
      walkSymlinks(p);
    }
  }
}
walkSymlinks(path.join(base, 'node_modules'));

// 3. 原生模块 allowlist（nft 对 .node/bindings 动态加载可能漏）：整目录纳入
for (const pkg of ['sqlite3', 'sharp', 'bcrypt', 'pg-native', 'pg']) {
  const dir = path.join(base, 'node_modules', pkg);
  if (!fs.existsSync(dir)) continue;
  fs.cpSync(dir, path.join(stage, 'node_modules', pkg), { recursive: true });
  copied++;
}

// 4. fs 读取的手动文件（nft 不追踪 fs.readFile）
for (const rel of [
  'dist',
  'package.json',
  'seerr-version.json',
  'sinerr-api.yml',
  'next.config.ts',
]) {
  if (fs.existsSync(path.join(base, rel))) {
    fs.cpSync(path.join(base, rel), path.join(stage, rel), { recursive: true });
  }
}

// 5. config 目录占位（运行时创建）
fs.mkdirSync(path.join(stage, 'config'), { recursive: true });

function dirSize(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  let total = 0;
  for (const f of files) {
    const p = path.join(dir, f.name);
    total += f.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

const orig = dirSize(path.join(base, 'node_modules'));
const staged = dirSize(path.join(stage, 'node_modules'));
console.log(`node_modules: ${(orig / 1048576).toFixed(1)}MB → staged ${(staged / 1048576).toFixed(1)}MB (${((1 - staged / orig) * 100).toFixed(1)}% 削减)`);
console.log(`Runtime stage ready at .runtime-stage/ (${(dirSize(stage) / 1048576).toFixed(1)}MB)`);
