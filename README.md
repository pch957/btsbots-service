# BTSBots Service (比特股零信任签名守护客户端)

`btsbots-service` 是基于 **Tauri + React 19 + TypeScript + Vite** 构建的桌面级轻量化比特股零信任签名网关与微支付风控中心。

[English Documentation (README-en.md)](README-en.md)

---

## 🌟 核心特性与架构

1. **Web 前端与私钥物理隔离 (Zero-Trust)**:
   - 网页端/移动端不存储真实 BitShares WIF 私钥，交易请求发送至本地守护进程。
   - `btsbots-service` 在本地通过 PBKDF2 + AES-256-GCM 保护私钥金库。

2. **自动启动网关**:
   - 采用类似网站登录的门禁设计，未解锁前阻止所有敏感视图展示。
   - 解锁/导入/注册成功后，自动启动后台签名网关与 OAuth 授权守护。

3. **多账号独立风控 (Multi-Account Risk Control)**:
   - 每个登录账号拥有独立的 `security_rules_${account}.json` 策略配置。
   - 精细配置单笔转账额度、多币种免密微支付基准、偏离度套利熔断及交易所 Memo 保护。

4. **安全锁屏与 PIN 码防护**:
   - 支持设置独立的本地 PIN 码，支持 5 分钟闲置自动锁定与一键主动锁屏。
   - 保证桌面设备离开视线时私钥与操作权限的安全。

5. **导出反馈提示**:
   - 导出密钥备份、导出风控 JSON 策略、导出审计日志均带有标准提示与自动文件保存。

---

## 🛠️ 本地开发与打包

### 前置要求
- Node.js >= 20
- Rust 与 Cargo 工具链

### 安装依赖
```bash
npm install
```

### 启动本地开发
```bash
npm run tauri dev
```

### 编译 Linux deb 安装包
Linux 平台下已配置仅生成标准的 `.deb` 安装包：
```bash
npm run tauri build
```
编译产物位于 `src-tauri/target/release/bundle/deb/`。

---

## 📄 授权协议
本项目遵循 MIT License 协议开源。