import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const failures = [];
function hasFiles(path) {
  if (!existsSync(path)) return false;
  const info = lstatSync(path);
  if (info.isFile()) return true;
  return readdirSync(path).some((entry) => hasFiles(join(path, entry)));
}
const forbiddenPaths = [
  "AGENTS.md",
  ".agents",
  ".opencode",
  "public/fixtures/demo-match.json",
  "research-harness/templates",
];
for (const path of forbiddenPaths) {
  if (hasFiles(resolve(root, path))) failures.push(`forbidden public-tree path exists: ${path}`);
}

const committedPaths = execFileSync("git", ["log", "HEAD", "--name-only", "--pretty=format:"], {
  cwd: root,
  encoding: "utf8",
}).split(/\r?\n/).filter(Boolean);
for (const path of forbiddenPaths) {
  if (committedPaths.some((candidate) => candidate === path || candidate.startsWith(`${path}/`))) {
    failures.push(`forbidden path exists in public HEAD ancestry: ${path}`);
  }
}

for (const path of ["LICENSE", "LICENSE-APACHE-2.0", "THIRD_PARTY_NOTICES.md"]) {
  if (!existsSync(resolve(root, path))) failures.push(`required licence file is missing: ${path}`);
}
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
if (!dockerfile.includes("LICENSE-APACHE-2.0")) failures.push("Docker runtime omits Apache-2.0 licence copy");
const dockerignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
for (const required of [".env", "secrets", "*.pem", "*.key", "research-harness/records/submissions/private"]) {
  if (!dockerignore.split(/\r?\n/).includes(required)) failures.push(`.dockerignore does not exclude ${required}`);
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "server-dist") continue;
    if (entry.isDirectory()) result.push(...filesUnder(path));
    else if (entry.isFile() && lstatSync(path).size < 1_000_000) result.push(path);
  }
  return result;
}

function isLocalSecretPath(file) {
  const path = relative(root, file);
  return path === ".env" ||
    (path.startsWith(".env.") && path !== ".env.example") ||
    path === "secrets" ||
    path.startsWith("secrets/");
}

const allCurrentFiles = filesUnder(root);
const localSecretFiles = allCurrentFiles.filter(isLocalSecretPath);
for (const file of localSecretFiles) {
  const path = relative(root, file);
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--", path], { cwd: root });
  } catch {
    failures.push(`local secret path is not ignored: ${path}`);
  }
  if ((lstatSync(file).mode & 0o077) !== 0) failures.push(`local secret permissions are too broad: ${path}`);
}

const secretPatterns = [
  { label: "JWT", regex: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { label: "TxLINE API token", regex: /txoracle_api_[a-fA-F0-9]{20,}/ },
  { label: "private key PEM", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "non-empty secret env assignment", regex: /^(?:TXLINE_GUEST_JWT|TXLINE_API_TOKEN|ANCHOR_WALLET)=(?!<)[^\s#]+/m },
];
for (const file of allCurrentFiles.filter((file) => !isLocalSecretPath(file))) {
  const text = readFileSync(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.regex.test(text)) failures.push(`${pattern.label} found in ${relative(root, file)}`);
  }
}

const history = execFileSync("git", ["log", "-p", "HEAD", "--no-ext-diff", "--no-textconv"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
for (const pattern of secretPatterns.slice(0, 3)) {
  if (pattern.regex.test(history)) failures.push(`${pattern.label} found in Git history`);
}

const dist = resolve(root, "dist");
if (!existsSync(dist)) failures.push("dist is missing; run npm run build first");
else {
  const browser = filesUnder(dist).map((file) => readFileSync(file, "utf8")).join("\n");
  const forbiddenBrowserTokens = [
    "TXLINE_GUEST_JWT",
    "TXLINE_API_TOKEN",
    "X-Api-Token",
    "Bearer ",
    "subTreeProof",
    "eventStatRoot",
    "contract-jwt",
    "txoracle_api_e2e_only",
    "Azul Teste",
    "demo_signature",
  ];
  for (const token of forbiddenBrowserTokens) {
    if (browser.includes(token)) failures.push(`browser bundle contains forbidden token: ${token}`);
  }
}

const idl = readFileSync(resolve(root, "vendor/txodds/devnet-txoracle.json"));
const idlHash = createHash("sha256").update(idl).digest("hex");
if (idlHash !== "1e7d55726eda9ad4d6ef62910fe5d7e007c687f4ff8b1c771a42b69b7089724e") {
  failures.push(`official IDL hash mismatch: ${idlHash}`);
}

const audit = spawnSync("npm", ["audit", "--omit=dev", "--audit-level=high"], { cwd: root, encoding: "utf8" });
if (audit.status !== 0) failures.push("npm production audit reports a high/critical advisory");

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`SECURITY FAIL: ${failure}\n`);
  process.exit(1);
}
process.stdout.write("SECURITY OK: public tree + HEAD ancestry exclusions/secrets, ignored mode-private local credentials, browser bundle, IDL pin, and high/critical production audit passed.\n");
