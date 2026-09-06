# BTSBots Service (Zero-Trust BitShares Signing Gateway)

`btsbots-service` is a high-performance, lightweight desktop zero-trust signing daemon and micro-payment risk control center built with **Tauri, React 19, TypeScript, and Vite**.

[中文文档 (README.md)](README.md)

---

## 🌟 Key Features & Architecture

1. **Zero-Trust Physical Key Isolation**:
   - Web/Mobile clients never store real BitShares WIF private keys. All transaction intents are audited by this local daemon.
   - Private keys are encrypted locally using PBKDF2 + AES-256-GCM.

2. **Web-Style Gate & Automatic Launch**:
   - Gated authentication: unauthorized views are fully blocked until account unlock.
   - Upon unlocking, importing, or registering, the signing daemon & OAuth listener start automatically.

3. **Account-Specific Risk Policies**:
   - Each account has its own isolated `security_rules_${account}.json`.
   - Granular configurations for fee breakers, base micro-payment limits, price volatility guards, and strict exchange Memo rules.

4. **Screen Lock & Security PIN**:
   - Set up an offline PIN for instant manual lock and 5-minute inactivity auto-locking.
   - Completely prevents unauthorized physical access.

5. **User Feedback for Exports**:
   - Clear alerts and structured downloads for credential backups, JSON policies, and audit logs.

---

## 🛠️ Development & Build

### Requirements
- Node.js >= 20
- Rust & Cargo Toolchain

### Install Dependencies
```bash
npm install
```

### Run in Development Mode
```bash
npm run tauri dev
```

### Build Linux deb Package
Configured specifically for Debian/Ubuntu `.deb` packages:
```bash
npm run tauri build
```
The output is located in `src-tauri/target/release/bundle/deb/`.

---

## 📄 License
Open-sourced under the MIT License.