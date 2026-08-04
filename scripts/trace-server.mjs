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
// 顶层 node_modules/<pkg> 是 pnpm symlink，必须 realpath 解析到 .pnpm 真实路径后复制；
// 直接对 symlink 用 fs.cpSync 会把真实目录写入已存在的 symlink，触发
// ERR_FS_CP_DIR_TO_NON_DIR（Docker 构建实测报错）。
// @next/swc-*：Next 运行时按 `${platform}-${arch}` 动态 require，nft 无法静态追踪，
// 且平台可选依赖没有顶层 symlink（只在 .pnpm），顶层找不到时需搜索 .pnpm。
for (const pkg of [
  'sqlite3',
  'sharp',
  'bcrypt',
  'pg-native',
  'pg',
  '@next/swc-linux-x64-gnu',
  '@next/swc-linux-x64-musl',
  '@next/swc-darwin-arm64',
  '@next/swc-darwin-x64',
  '@next/swc-win32-x64-msvc',
]) {
  const link = path.join(base, 'node_modules', pkg);
  let real;
  let dests = [];
  try {
    real = fs.realpathSync(link);
    dests.push([real, path.join(stage, path.relative(base, real))]);
  } catch {
    // 平台可选依赖：顶层无 symlink，搜索 .pnpm/*/node_modules/<pkg>
    const pnpmDir = path.join(base, 'node_modules', '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      for (const entry of fs.readdirSync(pnpmDir)) {
        const cand = path.join(pnpmDir, entry, 'node_modules', pkg);
        if (!fs.existsSync(cand)) continue;
        if (fs.lstatSync(cand).isSymbolicLink()) continue; // 跳过 next@... 内部的 symlink
        dests.push([cand, path.join(stage, path.relative(base, cand))]);
      }
    }
    if (dests.length === 0) {
      console.warn(`[trace] allowlist skip (not installed): ${pkg}`);
      continue;
    }
  }
  for (const [src, dest] of dests) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // 与第 1 步已追踪复制的部分文件合并（force 默认 true），补齐 .node 原生绑定等
    fs.cpSync(src, dest, { recursive: true });
    console.log(`[trace] allowlist copied: ${pkg}`);
    copied++;
  }
}

// 4. Next.js 动态 require 白名单
// Next 运行时通过 require-hook 代理加载 next/dist/compiled/*（webpack/swc/babel 等打包依赖），
// nft 静态分析无法追踪（Docker 冒烟实测：Cannot find module 'next/dist/compiled/webpack/webpack-lib'）。
// 整目录纳入最稳妥。
for (const sub of ['next/dist/compiled']) {
  let realDir;
  try {
    realDir = fs.realpathSync(path.join(base, 'node_modules', sub));
  } catch {
    continue; // 未安装（如未使用 Next）
  }
  const destDir = path.join(stage, path.relative(base, realDir));
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(realDir, destDir, { recursive: true });
  copied++;
}

// 5. Turbopack SSR externals
// Next 16 构建时把客户端包（react-intl/swr/formik/lodash 等）在 .next/node_modules 下
// 生成为「哈希名 symlink」（如 react-intl-eb77eec6fecfa1b3 → ../../node_modules/.pnpm/...）。
// 运行时 SSR 按哈希名 require，nft 无法追踪这些目标，必须按 symlink 解析并递归复制真实包及其依赖。
const nextExternalsDir = path.join(base, '.next', 'node_modules');
const extVisited = new Set();
function findPkgNodeModules(p) {
  let d = path.dirname(p);
  while (path.basename(d) !== 'node_modules' && d !== base && path.dirname(d) !== d) {
    d = path.dirname(d);
  }
  return path.basename(d) === 'node_modules' ? d : null;
}
function copyExtRealDir(real) {
  try {
    real = fs.realpathSync(real);
  } catch {
    return;
  }
  if (extVisited.has(real)) return;
  extVisited.add(real);
  const rel = path.relative(base, real);
  if (rel.startsWith('..') || !rel.startsWith('node_modules')) return;
  const dest = path.join(stage, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // 始终合并复制：nft 可能部分追踪了该包（如 axios 缺 index.js），跳过会保留残缺目录
  fs.cpSync(real, dest, { recursive: true });
  console.log(`[trace] next-external copied: ${rel}`);
  copied++;
  // 该包在 .pnpm 下的依赖 symlink（兄弟节点），递归解析真实目标
  const nm = findPkgNodeModules(real);
  if (!nm || !fs.existsSync(nm)) return;
  for (const entry of fs.readdirSync(nm, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      copyExtRealDir(path.join(nm, entry.name));
    } else if (entry.isDirectory()) {
      // scoped 目录：继续下钻找 symlink
      for (const e2 of fs.readdirSync(path.join(nm, entry.name), { withFileTypes: true })) {
        if (e2.isSymbolicLink()) copyExtRealDir(path.join(nm, entry.name, e2.name));
      }
    }
  }
}
if (fs.existsSync(nextExternalsDir)) {
  for (const entry of fs.readdirSync(nextExternalsDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      copyExtRealDir(path.join(nextExternalsDir, entry.name));
    } else if (entry.isDirectory()) {
      // scoped 目录（@scope/pkg-hash symlink 在内，如 @tanem/react-nprogress-*）
      const scopeDir = path.join(nextExternalsDir, entry.name);
      for (const e2 of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (e2.isSymbolicLink()) copyExtRealDir(path.join(scopeDir, e2.name));
      }
    }
  }
}

// 6. fs 读取的手动文件（nft 不追踪 fs.readFile）
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

// 7. config 目录占位（运行时创建）
fs.mkdirSync(path.join(stage, 'config'), { recursive: true });

function dirSize(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  let total = 0;
  for (const f of files) {
    const p = path.join(dir, f.name);
    // lstat：不跟随 symlink（stage 中存在未追踪到的悬空 symlink，statSync 会抛 ENOENT）
    total += f.isDirectory() ? dirSize(p) : fs.lstatSync(p).size;
  }
  return total;
}

const orig = dirSize(path.join(base, 'node_modules'));
const staged = dirSize(path.join(stage, 'node_modules'));
console.log(`node_modules: ${(orig / 1048576).toFixed(1)}MB → staged ${(staged / 1048576).toFixed(1)}MB (${((1 - staged / orig) * 100).toFixed(1)}% 削减)`);
console.log(`Runtime stage ready at .runtime-stage/ (${(dirSize(stage) / 1048576).toFixed(1)}MB)`);
