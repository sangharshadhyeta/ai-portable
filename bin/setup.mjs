// AI-Portable: Gemma 4 E4B (llama.cpp) with the Pi coding agent, run straight from a pendrive.
// Install.bat fetches Node.js with Windows' own tools (curl, certutil, tar) and runs this file, which sets up the rest on the drive -
// the engine, Pi and the model, on one screen with one progress bar, each piece checked against its published SHA-256 while it
// downloads - then starts the engine and Pi. No PowerShell and no packages: plain Node.js. Install.bat points the user, temp and
// app-data folders into this drive before anything starts, so nothing is written to the PC.
//   node setup.mjs [workdir]    the Pi coding agent in this window (default workdir: <drive>\AI-Portable\work)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";


const WORK_ARG = process.argv[2] || "";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = path.join(ROOT, "home");
const WIN = process.platform === "win32";

// ---- the pinned pieces --------------------------------------------------------------------------------------------------------------
const LLAMA_TAG = "b12180";
const LLAMA_ZIP = `llama-${LLAMA_TAG}-bin-win-cpu-x64.zip`;
const LLAMA_SHA = "b272cddf0e9c0692df0587b6f4cb8de4296e2d136b1b5b095ac0fe9807deeb20";
const PI_PKG = "@earendil-works/pi-coding-agent@1.5.0";
// The model. The choice is kept in home\model.txt (e4b or e2b); delete that file to be asked again.
const MODELS = {
    e4b: { name: "Gemma 4 E4B", repo: "NobodyWho/Google_Gemma4-E4B-GGUF", file: "gemma-4-E4B-it-Q4_K_M.gguf", size: 4977169568,
           sha: "519b9793ed6ce0ff530f1b7c96e848e08e49e7af4d57bb97f76215963a54146d", info: "smarter, 5.0 GB, needs about 6.5 GB of free RAM" },
    e2b: { name: "Gemma 4 E2B", repo: "NobodyWho/Google_Gemma4-E2B-GGUF", file: "gemma-4-E2B-it-Q4_K_M.gguf", size: 3106736256,
           sha: "9378bc471710229ef165709b62e34bfb62231420ddaf6d729e727305b5b8672d", info: "lighter and faster to load, 3.1 GB, about 4 GB of RAM, less capable" },
};
MODELS.e4b.needGB = 6.5; MODELS.e2b.needGB = 4.5;
const MODEL_TXT = path.join(HOME, "model.txt");   // "e2b", "e4b", or "hf:owner/repo/file.gguf" for any model typed in at the prompt

// Option 3: any GGUF model on Hugging Face. Looks the repo up, lets the user pick a file, and takes the size and SHA-256 from Hugging Face.
async function customModel(ask, spec) {
    let repo = spec, file = "";
    const parts = spec.replace(/^https?:\/\/huggingface\.co\//, "").split("/");
    if (parts.length >= 2) { repo = parts[0] + "/" + parts[1]; if (parts.length > 2) file = parts[parts.length - 1]; }
    let tree = null;
    for (const host of ["huggingface.co", "hf-mirror.com"]) {
        try { const r = await fetch(`https://${host}/api/models/${repo}/tree/main`, { signal: AbortSignal.timeout(20000) }); if (r.ok) { tree = await r.json(); break; } } catch {}
    }
    if (!Array.isArray(tree)) return null;
    const ggufs = tree.filter((x) => /\.gguf$/i.test(x.path) && x.lfs && !/mmproj|-0000\d-of-/i.test(x.path));
    if (!ggufs.length) return null;
    let f = file && ggufs.find((x) => x.path === file);
    if (!f) {
        ggufs.sort((a, b) => a.lfs.size - b.lfs.size);
        const def = ggufs.find((x) => /Q4_K_M/i.test(x.path)) || ggufs[0];
        console.log("\n  Files in " + repo + ":\n");
        ggufs.slice(0, 20).forEach((x, i) => console.log(`   ${i + 1}  ${x.path.padEnd(46)} ${(x.lfs.size / 1e9).toFixed(2)} GB${x === def ? "  (default)" : ""}`));
        const a = (await ask("\n  Enter = default, or a number > ")).trim();
        f = /^\d+$/.test(a) && ggufs[+a - 1] ? ggufs[+a - 1] : def;
    }
    return { name: repo.split("/")[1].replace(/-GGUF$/i, ""), repo, file: f.path, size: f.lfs.size, sha: f.lfs.oid,
             needGB: Math.max(3, f.lfs.size / 1e9 * 1.3), custom: true, info: "" };
}
function saved() { try { return fs.readFileSync(MODEL_TXT, "utf8").trim(); } catch { return ""; } }
let CHOICE = saved(), CH = null;
if (MODELS[CHOICE.toLowerCase()]) { CHOICE = CHOICE.toLowerCase(); CH = MODELS[CHOICE]; }
else if (CHOICE.startsWith("hf:")) { CH = await customModel(async () => "", CHOICE.slice(3)).catch(() => null); }   // re-read its details (no questions asked)
if (!CH) {
    CHOICE = "e2b"; CH = MODELS.e2b;
    if (process.stdin.isTTY) {
        const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q) => new Promise((r) => rl.question(q, r));
        console.log("\n  Which model?\n");
        console.log(`   1  ${MODELS.e2b.name}   ${MODELS.e2b.info}  (default)`);
        console.log(`   2  ${MODELS.e4b.name}   ${MODELS.e4b.info}`);
        console.log("   3  Another one from Hugging Face: type its name (owner/repo, e.g. unsloth/gemma-3-4b-it-GGUF)\n");
        let a = (await ask("  Enter = 1 > ")).trim();
        if (a === "2") { CHOICE = "e4b"; CH = MODELS.e4b; }
        else if (a === "3" || a.includes("/")) {
            for (;;) {
                if (a === "3" || !a) a = (await ask("  Hugging Face model (owner/repo) > ")).trim();
                if (!a) break;
                const c = await customModel(ask, a);
                if (c) { CH = c; CHOICE = `hf:${c.repo}/${c.file}`; break; }
                console.log("  Could not find GGUF files for that name (is it spelled like owner/repo, and does it have .gguf files?). Try again, or press Enter for the default.");
                a = "";
            }
        }
        rl.close();
    }
    try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(MODEL_TXT, CHOICE); } catch {}
}
const MODEL_REPO = CH.repo, MODEL_FILE = CH.file, MODEL_SHA = CH.sha;
const PORT = 8765;

const ENGINE = path.join(ROOT, "engine", WIN ? "llama-server.exe" : "llama-server");
const PI_CLI = path.join(ROOT, "pi", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
const PI_DONE = path.join(ROOT, "pi", "node_modules", ".package-lock.json");   // npm writes this last: its absence means an interrupted install
const piOk = () => fs.existsSync(PI_CLI) && fs.existsSync(PI_DONE);
const MODEL = path.join(ROOT, "models", MODEL_FILE);
const NPM_CLI = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const ERROR_LOG = path.join(HOME, "error.log");

for (const d of [HOME, path.join(HOME, "temp"), path.join(ROOT, "models")]) fs.mkdirSync(d, { recursive: true });

// ---- the screen ---------------------------------------------------------------------------------------------------------------------
const W = 66;
const ESC = "\x1b[";
const col = { cyan: "36", dcyan: "2;36", white: "97", gray: "37", dgray: "90", green: "32", yellow: "33", red: "31" };
const paint = (c, s) => `${ESC}${col[c]}m${s}${ESC}0m`;
const pad = (s, n) => (s.length > n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const fmtSize = (b) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(2)} GB` : b >= 1 << 20 ? `${Math.round(b / (1 << 20))} MB` : `${Math.round(b / 1024)} KB`);
const fmtLeft = (s) => (!isFinite(s) || s < 0 ? "" : s >= 3600 ? `${Math.floor(Math.round(s / 60) / 60)}h ${String(Math.round(s / 60) % 60).padStart(2, "0")}m left` : s >= 60 ? `${Math.ceil(s / 60)} min left` : `${Math.round(s)} s left`);
const SPIN = ["|", "/", "-", "\\"];

const items = [];
const add = (key, label, size) => items.push({ key, label, size, done: 0, state: "waiting", note: "" });
if (process.env.AIP_NODE_FETCHED) { add("node", `Node.js ${process.version}`, 40e6); items[0].state = "done"; items[0].done = items[0].size; }   // fetched by Install.bat just before
if (!fs.existsSync(ENGINE)) add("engine", `llama.cpp engine (${LLAMA_TAG})`, 24749382);
if (!piOk()) add("pi", "Pi coding agent 1.5.0", 130e6);
if (!fs.existsSync(MODEL)) add("model", `${CH.name} model (Q4_K_M)`, CH.size);
let speed = 0, status = "", tick = 0, lastDraw = 0, screenOn = false;

function draw(force = false) {
    const now = Date.now();
    if (!force && now - lastDraw < 150) return;
    lastDraw = now; tick++;
    const hr = "\u2500".repeat(W);
    const line = (inner, c = "gray") => paint("dcyan", "  \u2502 ") + paint(c, pad(inner, W - 2)) + paint("dcyan", " \u2502");
    const out = [];
    out.push(paint("dcyan", `  \u250C${hr}\u2510`));
    out.push(line(`AI-Portable   ${CH.name}  +  Pi coding agent`, "white"));
    out.push(line("First start: setting up on this drive \u00B7 nothing goes on the PC", "dgray"));
    out.push(paint("dcyan", `  \u251C${hr}\u2524`));
    for (const it of items) {
        const [mark, c] = it.state === "done" ? [" \u2713 done ", "green"] : it.state === "active" ? [`   ${SPIN[tick % 4]}    `, "yellow"] : it.state === "failed" ? [" \u2717 fail ", "red"] : ["        ", "dgray"];
        out.push(line(mark + pad(it.label, 31) + pad(fmtSize(it.size), 10) + it.note, c));
    }
    out.push(paint("dcyan", `  \u251C${hr}\u2524`));
    const total = items.reduce((a, it) => a + it.size, 0), done = items.reduce((a, it) => a + Math.min(it.done, it.size), 0);
    const barW = W - 20;
    const barRow = (frac, right, c = "cyan") => {
        const fill = Math.floor(Math.max(0, Math.min(1, frac)) * barW);
        return paint("dcyan", "  │ ") + paint(c, "█".repeat(fill) + "░".repeat(barW - fill)) + paint("white", pad(`  ${String(Math.floor(Math.max(0, Math.min(1, frac)) * 100)).padStart(3)}%  `, 8)) +
               paint("gray", pad(right, 10)) + paint("dcyan", " │");
    };
    const cur = items.find((x) => x.state === "active");
    out.push(line(cur ? `Now: ${cur.label}` : "Now: -", "white"));
    out.push(barRow(cur ? cur.done / cur.size : 0, cur ? fmtSize(Math.min(cur.done, cur.size)) : "", "yellow"));
    out.push(line(cur ? `of ${fmtSize(cur.size)}` + (speed > 0 ? `   ${fmtSize(speed)}/s   ${fmtLeft((cur.size - cur.done) / speed)}` : "") : "", "dgray"));
    out.push(paint("dcyan", `  ├${hr}┤`));
    out.push(line("Overall", "white"));
    out.push(barRow(total > 0 ? done / total : 1, fmtSize(done)));
    out.push(line(`of ${fmtSize(total)}` + (speed > 0 ? `   ${fmtLeft((total - done) / speed)}` : ""), "dgray"));
    out.push(line(status, "dgray"));
    out.push(paint("dcyan", `  \u2514${hr}\u2518`));
    process.stdout.write(`${ESC}H` + out.map((l) => l + `${ESC}K`).join("\n") + "\n");
    screenOn = true;
}

function waitEnter() {
    return new Promise((res) => {
        if (!process.stdin.isTTY) return res();
        process.stdout.write(paint("dgray", "  Press Enter to close ") );
        process.stdin.resume(); process.stdin.once("data", () => res());
    });
}
async function fail(msg, err) {
    try { fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${msg}\n${err && err.stack ? err.stack + "\n" : ""}`); } catch {}
    status = msg;
    if (screenOn) draw(true);
    process.stdout.write(`${ESC}?25h\n  ${paint("red", msg)}\n  ${paint("dgray", "Details: home\\error.log on this drive.")}\n\n`);
    await waitEnter();
    process.exit(1);
}

// ---- downloads: resumable, the next mirror when slow, SHA-256 while the bytes arrive ------------------------------------------------
function get(url, headers = {}, hops = 0) {
    return new Promise((res, rej) => {
        const lib = url.startsWith("https:") ? https : http;
        const req = lib.get(url, { headers: { "User-Agent": "AI-Portable/1.0", ...headers } }, (r) => {
            if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && hops < 10) {
                r.resume();
                return get(new URL(r.headers.location, url).toString(), headers, hops + 1).then(res, rej);
            }
            res({ res: r, req });
        });
        req.on("error", rej);
        req.setTimeout(60000, () => req.destroy(new Error("no data for 60 s")));
    });
}
async function getText(url) {
    const { res } = await get(url);
    if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode} for ${url}`); }
    let s = ""; for await (const c of res) s += c; return s;
}

async function download(item, urls, dst, sha) {
    const part = dst + ".part";
    let hash = crypto.createHash("sha256"), have = 0;
    if (fs.existsSync(part)) {   // an interrupted earlier start: hash what is there and continue after it
        status = "Resuming: checking the part already downloaded ..."; draw(true);
        for await (const c of fs.createReadStream(part, { highWaterMark: 1 << 20 })) { hash.update(c); have += c.length; }
    }
    item.state = "active"; item.done = have;
    let complete = false;
    // a dropped connection ("aborted") is normal on a long download: wait a moment and carry on from the byte where it stopped
    for (let attempt = 0; attempt < 40 && !complete; attempt++) {
        if (attempt > 0) { item.note = ""; status = `Connection dropped - retrying from ${fmtSize(have)} (try ${attempt} of 39) ...`; speed = 0; draw(true); await new Promise((ok) => setTimeout(ok, Math.min(2000 * attempt, 15000))); }
        for (let u = 0; u < urls.length && !complete; u++) {
            const last = u === urls.length - 1;
            item.note = u === 0 ? "" : "via mirror";
            status = `Downloading ${item.label}` + (u ? " from a mirror" : "");
            let r;
            try { r = await get(urls[u], have > 0 ? { Range: `bytes=${have}-` } : {}); }
            catch (e) { continue; }
            const { res, req } = r;
            if (res.statusCode === 416) { res.resume(); complete = true; break; }
            if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); continue; }
            if (have > 0 && res.statusCode === 200) { hash = crypto.createHash("sha256"); have = 0; item.done = 0; fs.rmSync(part, { force: true }); }
            const startHave = have, cl = Number(res.headers["content-length"]) || 0;
            const out = fs.createWriteStream(part, { flags: "a" });
            const t0 = Date.now(); let got = 0, slow = false, broke = false;
            try {
                for await (const c of res) {
                    hash.update(c); have += c.length; got += c.length; item.done = have;
                    if (!out.write(c)) await new Promise((ok) => out.once("drain", ok));
                    const el = (Date.now() - t0) / 1000;
                    if (el > 0.5) speed = got / el;
                    draw();
                    if (!last && el >= 10 && got / el < (1 << 20)) { slow = true; req.destroy(); break; }   // slow: the next mirror
                }
            } catch (e) { if (!slow) broke = true; }
            await new Promise((ok) => out.end(ok));
            if (slow || broke) continue;
            complete = !cl || have >= startHave + cl;
        }
    }
    if (!complete) { item.state = "failed"; throw new Error(`${item.label} could not be downloaded (the connection kept dropping). Run Install.bat again: it continues from where it stopped.`); }
    const got = hash.digest("hex");
    if (got !== sha.toLowerCase() && !item.refetched) {   // corrupt: throw the file away and fetch it once more from the start
        item.refetched = true; fs.rmSync(part, { force: true }); item.done = 0; status = "The download did not check out - fetching it again ..."; draw(true);
        return download(item, urls, dst, sha);
    }
    if (got !== sha.toLowerCase()) { fs.rmSync(part, { force: true }); item.state = "failed"; throw new Error(`${item.label} did not match its published checksum; it was deleted. Run Install.bat again.`); }
    fs.renameSync(part, dst);
    item.done = item.size; speed = 0;
}

function unzip(zip, dir) {   // Windows 10/11's own tar.exe reads zip files
    fs.mkdirSync(dir, { recursive: true });
    // (AIP_TAR: a test stand-in for tar.exe, a .cmd script, used only when set)
    const r = !WIN ? spawnSync("unzip", ["-q", "-o", zip, "-d", dir])
            : process.env.AIP_TAR ? spawnSync(process.env.ComSpec || "cmd.exe", ["/c", process.env.AIP_TAR, "-xf", zip, "-C", dir], { windowsHide: true })
            : spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dir], { windowsHide: true });
    if (r.status !== 0) throw new Error(`could not unpack ${path.basename(zip)}: ${String(r.stderr || r.error || "")}`);
}

function dirSize(d) {   // bytes under d (npm's download cache: few, large files, so this is cheap)
    let n = 0;
    try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size; } } catch {}
    return n;
}

function npmInstall(registry, logBase, onTick) {
    return new Promise((res) => {
        const outFd = fs.openSync(logBase + ".log", "a"), errFd = fs.openSync(logBase + ".err.log", "a");
        const p = spawn(process.execPath, [NPM_CLI, "install", "--prefix", path.join(ROOT, "pi"), "--no-audit", "--no-fund", "--loglevel", "error", "--registry", registry, PI_PKG],
                        { cwd: HOME, windowsHide: true, stdio: ["ignore", outFd, errFd], env: { ...process.env, npm_config_cache: path.join(HOME, "npm-cache"), npm_config_update_notifier: "false" } });
        const poll = setInterval(() => {
            onTick && onTick();
        }, 2000);
        p.on("exit", (code) => { clearInterval(poll); fs.closeSync(outFd); fs.closeSync(errFd); res(code); });
        p.on("error", () => { clearInterval(poll); res(-1); });
    });
}

async function setup() {
    if (items.length === 0) return;
    process.stdout.write(`${ESC}2J${ESC}H${ESC}?25l`);
    const freeDisk = (() => { try { return fs.statfsSync(ROOT).bavail * fs.statfsSync(ROOT).bsize; } catch { return Infinity; } })();
    if (!fs.existsSync(MODEL) && freeDisk < CH.size + 1.5 * (1 << 30)) await fail(`The first start needs about ${fmtSize(CH.size + 1.5 * (1 << 30))} free on this drive; it has ${fmtSize(freeDisk)}.`);
    // two windows installing at once would write into the same half-downloaded file and ruin it: only one at a time
    const LOCK = path.join(HOME, "install.lock");
    let other = 0; try { other = Number(fs.readFileSync(LOCK, "utf8")) || 0; } catch {}
    if (other && other !== process.pid) { let alive = false; try { process.kill(other, 0); alive = true; } catch {} if (alive) await fail("Another AI-Portable window is already installing on this drive. Close it, or wait until it is finished."); }
    try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(LOCK, String(process.pid)); } catch {}
    process.on("exit", () => { try { if (Number(fs.readFileSync(LOCK, "utf8")) === process.pid) fs.unlinkSync(LOCK); } catch {} });
    const timer = setInterval(() => draw(true), 250);
    try {
        for (const it of items) {
            if (it.state === "done") continue;
            if (it.key === "engine") {
                let sha = LLAMA_SHA;
                try {
                    const rel = JSON.parse(await getText(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${LLAMA_TAG}`));
                    const a = rel.assets.find((x) => x.name === LLAMA_ZIP);
                    if (a && a.digest) sha = a.digest.replace(/^sha256:/, "");
                } catch { /* the pinned value stands */ }
                const zip = path.join(ROOT, "llama.zip");
                await download(it, [`https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${LLAMA_ZIP}`], zip, sha);
                status = "Unpacking the engine ..."; draw(true);
                unzip(zip, path.join(ROOT, "engine")); fs.rmSync(zip, { force: true });
            } else if (it.key === "pi") {
                it.state = "active";
                const cache = path.join(HOME, "npm-cache", "_cacache"), base = dirSize(cache);
                for (const reg of ["https://registry.npmjs.org/", "https://registry.npmmirror.com/"]) {
                    it.note = reg.includes("npmmirror") ? "via mirror" : "";
                    status = "Installing Pi (many small files: a few minutes on a slow drive) ...";
                    await npmInstall(reg, path.join(HOME, "npm-install"), () => {   // real bytes downloaded so far
                        const got = Math.max(0, dirSize(cache) - base);
                        it.done = Math.min(it.size * 0.99, got);
                        status = `Installing Pi: ${fmtSize(got)} downloaded (many small files, slow on a slow connection) ...`;
                    });
                    if (piOk()) break;
                }
                if (!piOk()) { it.state = "failed"; throw new Error("Pi did not install (see home\\npm-install.err.log). Run Install.bat again."); }
                it.done = it.size;
            } else if (it.key === "model") {
                try {
                    const tree = JSON.parse(await getText(`https://huggingface.co/api/models/${MODEL_REPO}/tree/main`));
                    const f = tree.find((x) => x.path === MODEL_FILE);
                    if (f && f.lfs && f.lfs.oid && f.lfs.oid !== MODEL_SHA) throw new Error("The model's published checksum changed; this launcher expects a different file.");
                } catch (e) { if (String(e.message).includes("checksum changed")) throw e; }
                await download(it, [`https://huggingface.co/${MODEL_REPO}/resolve/main/${MODEL_FILE}`, `https://hf-mirror.com/${MODEL_REPO}/resolve/main/${MODEL_FILE}`], MODEL, MODEL_SHA);
            }
            it.state = "done"; it.note = ""; speed = 0; draw(true);
        }
        status = "Everything is on this drive."; draw(true);
    } catch (e) {
        clearInterval(timer);
        const it = items.find((x) => x.state === "active"); if (it) it.state = "failed";
        await fail(e.message, e);
    }
    clearInterval(timer);
    await new Promise((r) => setTimeout(r, 800));
}

// ---- run: the engine reads the model once into RAM, then Pi --------------------------------------------------------
function health() {
    return new Promise((res) => {
        const req = http.get({ host: "127.0.0.1", port: PORT, path: "/health", timeout: 2000 }, (r) => { r.resume(); res(r.statusCode === 200); });
        req.on("error", () => res(false)); req.on("timeout", () => { req.destroy(); res(false); });
    });
}

// Which folder Pi may work in. Dropping a folder on Install.bat skips the question; otherwise ask, remembering the last choice.
async function chooseWork() {
    const def = path.join(ROOT, "work"), lastFile = path.join(HOME, "workdir.txt");
    const user = process.env.USERNAME || "", pcHome = user ? `C:\\Users\\${user}` : "";
    const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
    let chosen = WORK_ARG.replace(/^"|"$/g, "");
    if (!chosen && process.stdin.isTTY) {
        let last = ""; try { last = fs.readFileSync(lastFile, "utf8").trim(); } catch {}
        const opts = [];
        const add = (label, p) => { if (p && isDir(p) && !opts.some((o) => o.p.toLowerCase() === p.toLowerCase())) opts.push({ label, p }); };
        add("Last used", last);
        add("Pendrive work folder", def);
        for (const base of [pcHome, pcHome && path.join(pcHome, "OneDrive")]) for (const n of ["Desktop", "Documents", "Downloads"]) add(n, base && path.join(base, n));
        const fallback = opts[0] ? opts[0].p : def;
        console.log(""); console.log(paint("white", "  Which folder should Pi work in?  (it can read and change files there)"));
        opts.forEach((o, i) => console.log(`   ${paint("cyan", String(i + 1))}  ${o.label.padEnd(22)} ${paint("dgray", o.p)}`));
        console.log(paint("dgray", "   A folder window is opening (look in the taskbar if you do not see it). Or here: type a number / paste a path, Enter = 1."));
        // the standard Windows folder dialog, via the PowerShell that every Windows has
        const ps = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::EnableVisualStyles();" +
            "$f=New-Object System.Windows.Forms.Form; $f.TopMost=$true; $f.StartPosition='CenterScreen'; $f.Size=New-Object System.Drawing.Size(1,1); $f.Opacity=0; $f.Show(); $f.Activate();" +
            "$d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Folder for Pi (the AI) to work in'; $d.ShowNewFolderButton=$true;" +
            "$d.SelectedPath=$env:AIP_START; if($d.ShowDialog($f) -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}; $f.Close()";
        // the window and the keyboard race: whichever answers first wins (so a hidden window can never block the start)
        const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
        const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", ps],
            { stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, AIP_START: fallback } });
        let out = ""; child.stdout.on("data", (d) => (out += d));
        const fromWindow = new Promise((res) => { child.on("exit", () => res(out.trim() || fallback)); child.on("error", () => res(null)); });
        const fromKeys = new Promise((res) => rl.question("  > ", (a) => {
            a = a.trim().replace(/^"|"$/g, "");
            res(!a ? fallback : /^\d+$/.test(a) && opts[+a - 1] ? opts[+a - 1].p : a);
        }));
        let picked = await Promise.race([fromWindow, fromKeys]);
        if (picked === null) picked = await fromKeys;   // PowerShell missing: keyboard only
        try { child.kill(); } catch {} rl.close();
        chosen = isDir(picked) ? picked : (console.log(paint("yellow", `  "${picked}" is not a folder; using ${fallback}`)), fallback);
    }
    chosen = chosen || def;
    fs.mkdirSync(chosen, { recursive: true });
    try { fs.writeFileSync(lastFile, chosen); } catch {}
    return path.resolve(chosen);
}

async function run() {
    const agentDir = path.join(HOME, "pi-agent");
    const modelsJson = path.join(agentDir, "models.json");
    {
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(modelsJson, JSON.stringify({ providers: { local: { baseUrl: `http://127.0.0.1:${PORT}/v1`, api: "openai-completions", apiKey: "local",
            models: [{ id: "gemma-4-local", name: CH.name + " (on this drive)", reasoning: !CH.custom, contextWindow: 32768, maxTokens: 8192 }] } } }, null, 2));
    }
    process.stdout.write(`${ESC}2J${ESC}H${ESC}?25h`);
    const freeGB = os.freemem() / (1 << 30), totalGB = os.totalmem() / (1 << 30);
    try {
        const lines = fs.readFileSync(path.join(ROOT, "bin", "logo.txt"), "utf8").split(/\r?\n/);
        lines.forEach((l, i) => console.log(paint(i < 5 ? "cyan" : "dgray", l)));
    } catch { console.log("\n" + paint("white", `  AI-Portable   ${CH.name}  +  Pi coding agent`)); }
    console.log(paint("dgray", `  RAM: ${freeGB.toFixed(1)} GB free of ${totalGB.toFixed(1)} GB`));
    // a window that was force-closed can leave the engine of an earlier run holding RAM: end it (only this drive's copy)
    try { if (WIN) spawnSync("powershell.exe", ["-NoProfile", "-Command",
        `Get-Process llama-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${ROOT.replace(/'/g, "''")}*' } | Stop-Process -Force`], { windowsHide: true }); } catch {}
    // a .bat cannot carry an icon, so keep an "AI-Portable" shortcut with the logo next to it (re-made each start: the drive letter can change)
    try { if (WIN && fs.existsSync(path.join(ROOT, "bin", "logo.ico"))) {
        const q = (s) => s.replace(/'/g, "''");
        spawnSync("powershell.exe", ["-NoProfile", "-Command",
            `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${q(path.join(ROOT, "Start.lnk"))}'); $s.TargetPath='${q(path.join(ROOT, "Install.bat"))}'; ` +
            `$s.WorkingDirectory='${q(ROOT)}'; $s.IconLocation='${q(path.join(ROOT, "bin", "logo.ico"))}'; $s.Description='Gemma 4 + Pi from this drive'; $s.Save()`], { windowsHide: true });
    } } catch {}
    const work = await chooseWork();
    // Small models guess paths badly: tell Pi where it is and what is where (re-written on every start).
    try {
        const u = process.env.USERNAME || "", h = u ? `C:\\Users\\${u}` : "";
        const desk = [path.join(h, "Desktop"), path.join(h, "OneDrive", "Desktop")].find((p) => fs.existsSync(p));
        fs.writeFileSync(path.join(agentDir, "AGENTS.md"),
            `# Environment\n- Windows PC. Your working folder (the current directory) is: ${work}\n` +
            `- Use paths inside it. To reach other places use full absolute paths.\n` + (desk ? `- The user's Desktop is: ${desk}\n` : "") +
            `- Never guess a folder name: list the folder first (ls), then act. Keep answers short.\n`);
    } catch {}
    let ctx = 32768;
    const needGB = CH.needGB;
    if (freeGB < needGB) { console.log(paint("yellow", `  Less than ${needGB.toFixed(1)} GB of RAM is free: close other programs (browser tabs use a lot). Using a smaller context (8K).`)); ctx = 8192; }
    const logical = os.cpus().length;
    const threads = logical > 4 ? Math.round(logical / 2) : Math.max(1, logical - 1);   // generation is memory-bound: one thread per physical core beats using every hyper-thread
    const logOut = fs.openSync(path.join(HOME, "engine.out.log"), "w"), logErr = fs.openSync(path.join(HOME, "engine.log"), "w");
    const eng = spawn(ENGINE, ["-m", MODEL, "--jinja", "-c", String(ctx), "--host", "127.0.0.1", "--port", String(PORT), "-lm", freeGB >= needGB + 0.5 ? "none" : "mmap", "-t", String(threads), "-fa", "auto", "--cache-reuse", "256", "-tb", String(Math.max(1, logical - 1)), "--alias", "gemma-4-local"],
                      { windowsHide: true, stdio: ["ignore", logOut, logErr], cwd: HOME });
    let engDead = false;
    eng.on("exit", () => { engDead = true; });
    const stop = () => { try { if (!engDead) eng.kill(); } catch {} };
    process.on("exit", stop);
    for (const s of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(s, () => { stop(); process.exit(0); });

    // show llama.cpp's own log (it prints to stderr) while it loads the model
    const logPath = path.join(HOME, "engine.log");
    let logPos = 0;
    const showLog = () => {
        try {
            const fd = fs.openSync(logPath, "r"), size = fs.fstatSync(fd).size;
            if (size > logPos) { const buf = Buffer.alloc(size - logPos); fs.readSync(fd, buf, 0, buf.length, logPos); logPos = size; process.stdout.write(paint("dgray", buf.toString("utf8"))); }
            fs.closeSync(fd);
        } catch {}
    };
    const t0 = Date.now();
    console.log(paint("dgray", "  Starting llama.cpp (the model is read from this drive as it is needed):\n"));
    while (!(await health())) {
        showLog();
        if (engDead) {
            showLog();
            console.log("\n" + paint("red", "  The engine stopped while loading. Log: home\\engine.log"));
            await waitEnter(); process.exit(1);
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    showLog();
    process.stdout.write(`\n  ${paint("green", "Ready after " + Math.round((Date.now() - t0) / 1000) + " s.")}\n`);

    console.log(paint("dgray", `  Pi works in: ${work}`));
    await new Promise((r) => setTimeout(r, 800));
    const pi = spawn(process.execPath, [PI_CLI, "--model", "local/gemma-4-local"], {
        cwd: work, stdio: "inherit",
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" } });
    await new Promise((r) => pi.on("exit", r));
    stop();
    console.log("  Stopped.");
}

process.on("uncaughtException", (e) => fail(`Something went wrong: ${e.message}`, e));
process.on("unhandledRejection", (e) => fail(`Something went wrong: ${e && e.message ? e.message : e}`, e));
await setup();
await run();
