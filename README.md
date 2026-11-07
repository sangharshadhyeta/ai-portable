# AI-Portable

**A local coding assistant on a pendrive.** Gemma 4 runs on your PC's processor through [llama.cpp](https://github.com/ggml-org/llama.cpp), and the [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) works with it in a terminal window. No account, no cloud, no install: everything lives in one folder on the drive. Windows 10/11, 64-bit.

## Quick start

1. Copy this folder to a pendrive formatted **exFAT or NTFS** (not FAT32, which cannot hold the model file).
2. Double-click **`Install.bat`**. The first run downloads what is missing onto the drive (about 3-5 GB, each piece checked against its published SHA-256). It needs internet once.
3. Choose the folder Pi may work in when the folder window opens.
4. From then on use the **`Start`** shortcut (with the logo) that `Install.bat` puts in the folder. It works offline.

Close the window to stop everything. Dropping a folder onto `Start` skips the folder question.

## What it looks like

**First start** - the banner, then the model choice:

![Model choice](docs/1-model.png)

**Setting up on the drive** - real byte sizes, one bar for the current download and one for the whole job:

![Installing](docs/2-install.png)

**Loading the model** - llama.cpp's own log, then Pi starts in the folder you chose:

![Engine](docs/3-engine.png)

**Pi at work:**

![Pi](docs/4-pi.png)

> The images are rendered from the real terminal text of these screens (colours approximated), not pixel captures.

## Choosing the model

The first start asks which model to use:

| | Model | Size | RAM | |
|---|---|---|---|---|
| 1 | Gemma 4 **E2B** (Q4_K_M) | 3.1 GB | about 4 GB | lighter, faster to load, less capable (**default**) |
| 2 | Gemma 4 **E4B** (Q4_K_M) | 5.0 GB | about 6.5 GB | smarter |
| 3 | **Any GGUF model on Hugging Face** | - | about 1.3 x file size | type its name as `owner/repo`, then pick a file |

The choice is saved in `home\model.txt`. To change it later, delete that file and start again; you are asked again and the new model is downloaded if it is missing. Several models can sit in `models\` side by side.

For option 3 the file size and SHA-256 are taken from Hugging Face and checked after the download. Use a model with a chat template (an "it" / instruct model) and a single `.gguf` file; multi-part files are not offered.

## System requirements

| | |
|---|---|
| **Windows** | 64-bit Windows 10 (1803 or newer) or Windows 11. `curl.exe` and `tar.exe` must be present (they come with Windows 10 1803+). |
| **Processor** | Any 64-bit Intel/AMD processor with AVX (about 2011 or newer; AVX2 is faster). 4+ cores is better. No graphics card needed. |
| **RAM** | 8 GB minimum, 16 GB recommended. About 4 GB (E2B) or 6.5 GB (E4B) should be **free** when you start: close browsers first. With less free RAM it uses a shorter context (8K instead of 32K). |
| **Pendrive** | 5-7 GB free, exFAT or NTFS. USB 3 or faster is strongly recommended: each start reads the model from it. |
| **Internet** | Only for the first install. |
| **Not needed** | Administrator rights, installing anything, Python, a graphics card. |

## Speed

Measured with E4B on a Ryzen 7 7735U laptop (16 GB, USB drive): about **6.7 tokens/s** when writing, **35 tokens/s** reading the prompt, and a first start of about **4 minutes** while the model is read from a slow drive. E2B is smaller, so it loads faster and answers faster.

## Good to know

- **Nothing is installed on the PC and nothing is written to it.** The user, temp and app-data folders all point into the drive. (Windows itself still notes that a USB drive was connected and that a program ran.)
- **Small models are limited.** They are good for reading and explaining files, small edits, short scripts and single commands, and can lose their way on long multi-step tasks.
- **Pi can read and change files** in the folder you choose. Pick it deliberately.
- If a window is force-closed, the engine may keep running; the next start ends the leftover one. To free the RAM at once: `taskkill /IM llama-server.exe /F`.

## What gets downloaded (into the folder)

| Folder | Content |
|---|---|
| `engine\` | llama.cpp b12180, Windows x64 CPU build (MIT licence) |
| `node\` | Node.js v26.13.0 (MIT licence) |
| `pi\` | Pi coding agent 1.5.0, `@earendil-works/pi-coding-agent` (MIT licence) |
| `models\` | the Gemma 4 GGUF by NobodyWho, or the model you chose (see its own licence; Gemma terms of use) |
| `home\` | Pi's settings and history, logs, temp files |
| `work\` | Pi's default working folder |

## Files in this repository

`Install.bat` and `bin\launch.cmd` (fetch Node.js with Windows' own curl/certutil/tar), `bin\setup.mjs` (everything else: one screen, downloads, engine, Pi), `bin\logo.txt` / `bin\logo.ico`.
