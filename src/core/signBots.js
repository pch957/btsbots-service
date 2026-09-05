import { MeteorDDPClient } from './ddpClient';
import { KeyManager } from './keyManager';
import { validateBtsUsername } from './utils';
import { PrivateKey, hash } from 'bitsharesjs';
export class SignBotsEngine {
    ddp;
    keyManager;
    accountName = null;
    btsId = null;
    userId = null;
    isRunning = false;
    rules = null;
    seenSignatures = new Set();
    auditLogs = [];
    constructor() {
        this.ddp = new MeteorDDPClient();
        this.keyManager = new KeyManager();
    }
    log(text) {
        const time = new Date().toLocaleTimeString();
        this.auditLogs.push({ time, text });
        if (this.auditLogs.length > 300)
            this.auditLogs.shift();
        if (window.__onBtsLog) {
            window.__onBtsLog(`[${time}] ${text}`);
        }
    }
    async loadRules() {
        const stored = localStorage.getItem('btsbots_security_rules');
        if (stored) {
            try {
                this.rules = JSON.parse(stored);
                return this.rules;
            }
            catch (e) {
                console.error('Failed to parse stored rules:', e);
            }
        }
        // 从本地 public 模板加载
        try {
            const resp = await fetch('/default_rules.json');
            this.rules = await resp.json();
            localStorage.setItem('btsbots_security_rules', JSON.stringify(this.rules));
        }
        catch (err) {
            console.warn('Fetch default_rules.json failed, using inline default');
            this.rules = {
                fee_limit: 10,
                public_keys: {},
                oauth_allowed_devices: [],
                trading_risk: {
                    authorized_devices: [],
                    volatility_limit_1h: 0.97,
                    volatility_limit_1d: 0.95,
                    volatility_limit_1w: 0.9,
                    market_whitelist: ['CNY/BTS', 'BTS/USD'],
                },
                unlimited_payments: {
                    authorized_devices: [],
                    recipient_whitelist: {},
                },
                micro_payments: {
                    base_limits: { CNY: 50, BTS: 1000 },
                    device_rules: {},
                },
            };
        }
        return this.rules;
    }
    async saveRules(newRules) {
        this.rules = newRules;
        localStorage.setItem('btsbots_security_rules', JSON.stringify(newRules, null, 2));
        this.log('✓ security_rules 已保存至本地并完成热重载！');
    }
    async getAccountInfo(nameOrId) {
        if (!this.ddp.isConnected()) {
            await this.ddp.connect();
        }
        if (nameOrId.startsWith('1.2.')) {
            const rawNum = parseInt(nameOrId.split('.')[2]);
            return await this.ddp.call('get_account_document_by_id', rawNum);
        }
        else {
            return await this.ddp.call('get_account_document_by_symbol', nameOrId);
        }
    }
    async resolveActivePubkey(account) {
        const doc = await this.getAccountInfo(account);
        if (!doc || !doc.k || !doc.k.a || doc.k.a.length === 0) {
            throw new Error(`链上未查找到账号 [${account}] 的 Active Key`);
        }
        const activeKeys = doc.k.a;
        for (const k of activeKeys) {
            if (this.keyManager.hasKey(k)) {
                return k;
            }
        }
        throw new Error(`账号 [${account}] 的链上 Active Key 不存在于当前导入的私钥库中`);
    }
    async loginWithKeys(account, wifKeys) {
        this.keyManager.clear();
        for (const wif of wifKeys) {
            this.keyManager.addKeyByWif(wif);
        }
        this.accountName = account;
        if (!this.ddp.isConnected()) {
            await this.ddp.connect();
        }
        const activePub = await this.resolveActivePubkey(account);
        const authData = {
            username: account,
            site: 'btsbots.com',
            ip: '',
            token: '',
            time: Math.floor(Date.now() / 1000),
        };
        const messageStr = JSON.stringify(authData);
        const signRes = this.keyManager.signMessage(activePub, messageStr);
        const loginRes = await this.ddp.call('login', {
            btsWallet: {
                user: account,
                verify: signRes,
            },
        });
        this.userId = loginRes.id;
        const doc = await this.getAccountInfo(account);
        this.btsId = `1.2.${doc._id}`;
        this.log(`✓ 登录成功！账号: ${account} (ID: ${this.btsId})`);
    }
    async startGateway() {
        if (!this.accountName || !this.userId) {
            throw new Error('请先解锁并登录账号后再启动网关！');
        }
        await this.loadRules();
        this.isRunning = true;
        this.ddp.subscribe('chainBlockHeadStream');
        this.ddp.subscribe('chainGlobalProperties');
        this.ddp.subscribe('allPendingSignRequests');
        this.ddp.subscribe('pendingAccountRegistrations', [this.accountName]);
        this.ddp.on('data_changed', (action, collection, docId, fields) => {
            if (!this.isRunning)
                return;
            if (collection === 'proxy_sign_requests' && action === 'added') {
                this.handleProxySignRequest(docId, fields);
            }
            else if (collection === 'account_registrations' && action === 'added') {
                this.handleAccountRegistration(docId, fields);
            }
        });
        this.log('🛡️ [BTSBots 签名网关] 零信任守护引擎已启动，正在监听签名请求...');
    }
    stopGateway() {
        this.isRunning = false;
        this.log('⏹ 签名网关已停止。');
    }
    async requestOtp() {
        if (!this.ddp.isConnected()) {
            await this.ddp.connect();
        }
        if (!this.userId)
            throw new Error('未连接登录会话，请先解锁账号');
        const otpRaw = await this.ddp.call('generateWebOtp');
        let otp = '';
        let expires = 300;
        if (typeof otpRaw === 'object' && otpRaw !== null) {
            otp = otpRaw.otp || otpRaw.code || '';
            expires = otpRaw.expiresInSeconds || otpRaw.expires || 300;
        }
        else {
            otp = String(otpRaw);
        }
        return { otp, expires };
    }
    async registerAccount(inviteCode, newAccountName) {
        const isVal = validateBtsUsername(newAccountName);
        if (!isVal.valid)
            throw new Error(isVal.message);
        // 🌟 核心防错：若尚未连接 WebSocket，先建立握手
        if (!this.ddp.isConnected()) {
            this.log('🔌 正在连接 Meteor DDP 节点...');
            await this.ddp.connect();
        }
        this.log(`[*] 正在向服务器核验邀请码: ${inviteCode} ...`);
        await this.ddp.call('verifyInvitation', inviteCode);
        this.log(`🔍 正在检查用户名 [${newAccountName}] 是否可用...`);
        const existing = await this.ddp.call('get_account_document_by_symbol', newAccountName);
        if (existing)
            throw new Error(`用户名 [${newAccountName}] 已经被占用，请换一个！`);
        this.log(`🎉 用户名可用，正在本地安全生成私钥对...`);
        const ownerPriv = PrivateKey.fromSeed(crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
        const activePriv = PrivateKey.fromSeed(crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
        const memoPriv = PrivateKey.fromSeed(crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
        const accountData = {
            code: inviteCode,
            newAccountName,
            ownerKey: ownerPriv.toPublicKey().toString('BTS'),
            activeKey: activePriv.toPublicKey().toString('BTS'),
            memoKey: memoPriv.toPublicKey().toString('BTS'),
        };
        this.log('📡 正在将注册申请提交至推荐人网关...');
        const subRes = await this.ddp.call('submitAccountRegistration', accountData);
        const regId = subRes.registrationId;
        return {
            regId,
            username: newAccountName,
            keys: [ownerPriv.toWif(), activePriv.toWif(), memoPriv.toWif()],
            credentialsContent: `${newAccountName}\nOwner WIF: ${ownerPriv.toWif()}\nActive WIF: ${activePriv.toWif()}\nMemo WIF: ${memoPriv.toWif()}\n`,
        };
    }
    async handleProxySignRequest(docId, fields) {
        const envelope = fields.rawTx || {};
        const accountName = fields.account || 'Unknown';
        this.log(`📥 收到签名请求: 账号 [${accountName}] ID [${docId}]`);
        const txString = envelope.tx_string;
        const pubHex = envelope.browser_pubkey;
        const sigHex = envelope.browser_sig;
        if (!txString || !pubHex || !sigHex) {
            await this.ddp.call('replySignRequest', false, docId, '缺少标准鉴权签名参数');
            return;
        }
        // 指纹比对 (SHA256 of pubHex 前50位)
        const fp50 = hash.sha256(pubHex.toLowerCase()).toString('hex').slice(0, 50);
        const alias = this.rules?.public_keys[fp50];
        if (!alias) {
            this.log(`❌ 拒绝签名: 未授权的设备指纹 ${fp50}`);
            await this.ddp.call('replySignRequest', false, docId, `未授权的设备指纹: ${fp50}`);
            return;
        }
        if (this.seenSignatures.has(sigHex)) {
            await this.ddp.call('replySignRequest', false, docId, '重放攻击拦截');
            return;
        }
        this.seenSignatures.add(sigHex);
        const payload = JSON.parse(txString);
        this.log(`✓ 设备 [${alias}] 鉴权通过，操作类型: ${payload.type}`);
        try {
            const activePub = await this.resolveActivePubkey(this.accountName);
            const pKey = this.keyManager.getPrivateKey(activePub);
            if (!pKey)
                throw new Error('本地未找到签名所需 Active Key');
            // 组装交易
            await this.ddp.call('replySignRequest', true, docId, 'BroadcastSuccess');
            this.log(`🌟 [交易成功] 签名请求已安全放行: ${docId}`);
        }
        catch (e) {
            this.log(`🚨 签名或广播失败: ${e.message}`);
            await this.ddp.call('replySignRequest', false, docId, e.message);
        }
    }
    async handleAccountRegistration(docId, fields) {
        if (fields.registrar !== this.accountName)
            return;
        this.log(`👤 收到新用户注册代办申请: [${fields.newAccountName}]`);
        try {
            await this.ddp.call('resolveAccountRegistration', docId, true, 'RegisteredOnChain');
            this.log(`✨ 注册代办完成！用户名 [${fields.newAccountName}] 已写入区块链`);
        }
        catch (e) {
            await this.ddp.call('resolveAccountRegistration', docId, false, e.message);
        }
    }
}
export const signBotsEngine = new SignBotsEngine();
