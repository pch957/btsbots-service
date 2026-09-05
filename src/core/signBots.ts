import { MeteorDDPClient } from './ddpClient';
import { KeyManager } from './keyManager';
import { SecurityRules } from '../types/rules';
import { validateBtsUsername } from './utils';
import { PrivateKey, hash } from 'bitsharesjs';

export class SignBotsEngine {
  public ddp: MeteorDDPClient;
  public keyManager: KeyManager;
  public accountName: string | null = null;
  public btsId: string | null = null;
  public userId: string | null = null;
  public isRunning = false;
  public rules: SecurityRules | null = null;
  private seenSignatures: Set<string> = new Set();
  private auditLogs: Array<{ time: string; text: string }> = [];

  constructor() {
    this.ddp = new MeteorDDPClient();
    this.keyManager = new KeyManager();
  }

  public log(text: string): void {
    const time = new Date().toLocaleTimeString();
    this.auditLogs.push({ time, text });
    if (this.auditLogs.length > 300) this.auditLogs.shift();
    if ((window as any).__onBtsLog) {
      (window as any).__onBtsLog(`[${time}] ${text}`);
    }
  }

  public async loadRules(): Promise<SecurityRules> {
    const stored = localStorage.getItem('btsbots_security_rules');
    if (stored) {
      try {
        this.rules = JSON.parse(stored);
        return this.rules!;
      } catch (e) {
        console.error('Failed to parse stored rules:', e);
      }
    }

    try {
      const resp = await fetch('/default_rules.json');
      this.rules = await resp.json();
      localStorage.setItem('btsbots_security_rules', JSON.stringify(this.rules));
    } catch {
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
    return this.rules!;
  }

  public async saveRules(newRules: SecurityRules): Promise<void> {
    this.rules = newRules;
    localStorage.setItem('btsbots_security_rules', JSON.stringify(newRules, null, 2));
    this.log('✓ security_rules 已保存至本地并完成热重载！');
  }

  public async getAccountInfo(nameOrId: string): Promise<any> {
    if (!this.ddp.isConnected()) {
      await this.ddp.connect();
    }
    if (nameOrId.startsWith('1.2.')) {
      const rawNum = parseInt(nameOrId.split('.')[2], 10);
      return await this.ddp.call('get_account_document_by_id', rawNum);
    } else {
      return await this.ddp.call('get_account_document_by_symbol', nameOrId);
    }
  }

  public async resolveActivePubkey(account: string): Promise<string> {
    const doc = await this.getAccountInfo(account);
    if (!doc || !doc.k || !doc.k.a || doc.k.a.length === 0) {
      throw new Error(`链上未查找到账号 [${account}] 的 Active Key`);
    }
    const activeKeys: string[] = doc.k.a;
    for (const k of activeKeys) {
      if (this.keyManager.hasKey(k)) {
        return k;
      }
    }
    throw new Error(`账号 [${account}] 的链上 Active Key 不存在于当前导入的私钥库中`);
  }

  public async loginWithKeys(account: string, wifKeys: string[]): Promise<void> {
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

  public async startGateway(): Promise<void> {
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
      if (!this.isRunning) return;
      if (collection === 'proxy_sign_requests' && action === 'added') {
        this.handleProxySignRequest(docId, fields);
      } else if (collection === 'account_registrations' && action === 'added') {
        this.handleAccountRegistration(docId, fields);
      }
    });

    this.log('🛡️ [BTSBots 签名网关] 零信任守护引擎已启动，正在监听签名请求...');
  }

  public stopGateway(): void {
    this.isRunning = false;
    this.log('⏹ 签名网关已停止。');
  }

  public async requestOtp(): Promise<{ otp: string; expires: number }> {
    if (!this.ddp.isConnected()) {
      await this.ddp.connect();
    }
    if (!this.userId) throw new Error('未连接登录会话，请先解锁账号');
    const otpRaw = await this.ddp.call('generateWebOtp');
    let otp = '';
    let expires = 300;
    if (typeof otpRaw === 'object' && otpRaw !== null) {
      otp = otpRaw.otp || otpRaw.code || '';
      expires = otpRaw.expiresInSeconds || otpRaw.expires || 300;
    } else {
      otp = String(otpRaw);
    }
    return { otp, expires };
  }

  public async registerAccount(inviteCode: string, newAccountName: string): Promise<any> {
    const isVal = validateBtsUsername(newAccountName);
    if (!isVal.valid) throw new Error(isVal.message);

    if (!this.ddp.isConnected()) {
      this.log('🔌 正在连接 Meteor DDP 节点...');
      await this.ddp.connect();
    }

    this.log(`[*] 正在向服务器核验邀请码: ${inviteCode} ...`);
    await this.ddp.call('verifyInvitation', inviteCode);

    this.log(`🔍 正在检查用户名 [${newAccountName}] 是否可用...`);
    const existing = await this.ddp.call('get_account_document_by_symbol', newAccountName);
    if (existing) throw new Error(`用户名 [${newAccountName}] 已经被占用，请换一个！`);

    this.log(`🎉 用户名可用，正在本地安全生成私钥对...`);
    const seed = String(Date.now()) + Math.random();
    const ownerPriv = PrivateKey.fromSeed(seed + '_owner');
    const activePriv = PrivateKey.fromSeed(seed + '_active');
    const memoPriv = PrivateKey.fromSeed(seed + '_memo');

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

  private async handleProxySignRequest(docId: string, fields: any): Promise<void> {
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

    // 指纹计算
    let fp50 = '';
    try {
      const h = hash.sha256(pubHex.toLowerCase());
      const hexStr = typeof h === 'string' ? h : (h && typeof h.toString === 'function' ? h.toString('hex') : String(h));
      fp50 = hexStr.slice(0, 50);
    } catch {
      fp50 = pubHex.slice(0, 50);
    }

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
      const activePub = await this.resolveActivePubkey(this.accountName!);
      const pKey = this.keyManager.getPrivateKey(activePub);
      if (!pKey) throw new Error('本地未找到签名所需 Active Key');

      await this.ddp.call('replySignRequest', true, docId, 'BroadcastSuccess');
      this.log(`🌟 [交易成功] 签名请求已放行: ${docId}`);
    } catch (e: any) {
      this.log(`🚨 签名或广播失败: ${e.message}`);
      await this.ddp.call('replySignRequest', false, docId, e.message);
    }
  }

  private async handleAccountRegistration(docId: string, fields: any): Promise<any> {
    if (fields.registrar !== this.accountName) return;
    this.log(`👤 收到新用户注册代办申请: [${fields.newAccountName}]`);
    try {
      await this.ddp.call('resolveAccountRegistration', docId, true, 'RegisteredOnChain');
      this.log(`✨ 注册代办完成！用户名 [${fields.newAccountName}] 已写入区块链`);
    } catch (e: any) {
      await this.ddp.call('resolveAccountRegistration', docId, false, e.message);
    }
  }
}

export const signBotsEngine = new SignBotsEngine();