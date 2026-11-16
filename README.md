# CaretStudio

A code editor with an AI chat built in. You bring your own [OpenRouter](https://openrouter.ai) key; chats, settings and the key stay on your computer. There is no account and no server of ours.

## Install (Windows)
Download `CaretStudio-Setup-<version>.exe` from [Releases](https://github.com/plawanpawin-byte/Caret-IDE/releases/latest) and run it. The installer is not code-signed yet, so Windows SmartScreen may warn: choose "More info", then "Run anyway".
CaretStudio looks for new versions on GitHub and offers to install them (Settings, Profile, About; it can be turned off). Each download is checked against its published SHA-256.

## Build
Needs the VSCodium Windows zip unpacked into `app/`, then `node build.js` (output: `dist/CaretStudio`) and NSIS for `installer/caret-ide.nsi`.

## Credits
CaretStudio is built on [VSCodium](https://github.com/VSCodium/vscodium) (MIT), which is built from Microsoft's [Code - OSS](https://github.com/microsoft/vscode) (MIT). Their binaries and third-party notices are included unchanged. CaretStudio is not affiliated with or endorsed by Microsoft or VSCodium.

Licensed under the terms in `LICENSE`.
