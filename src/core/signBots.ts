import { MeteorDDPClient } from './ddpClient';
import { KeyManager } from './keyManager';
import { SecurityRules } from '../types/rules';
import { validateBtsUsername, hexToBuffer, bufferToHex } from './utils';
import { PrivateKey, PublicKey, hash, ops, Aes, TransactionBuilder } from 'bitsharesjs';
import { ChainConfig } from 'bitsharesjs-ws';
import { Buffer } from 'buffer';

// 🌟 统一锁定 BitShares 全局公钥前缀为 "BTS"
if (ChainConfig) {
  if (typeof (ChainConfig as any).setPrefix === 'function') {
    ChainConfig.setPrefix("BTS");
  }
  ChainConfig.address_prefix = "BTS";
}

const BITSHARES_CHAIN_ID = "4018d7844c78f6a6c41c6a552b898022310fc5dec06da467ee7905a8dad512c8";

interface TransferRecord {
  accountId: string;
  deviceAlias: string;
  asset: string;
  amount: number;
  timestamp: number;
}

export class SignBotsEngine {
  public ddp: MeteorDDPClient;
  public keyManager: KeyManager;
  public accountName: string | null = null;
  public btsId: string | null = null;
  public userId: string | null = null;
  public isRunning = false;
  public rules: SecurityRules | null = null;
  private seenSignatures: Set<string> = new Set();
  private inFlightDocs: Set<string> = new Set();
  public auditLogs: string[] = [];

  constructor() {
    this.ddp = new MeteorDDPClient();
    this.keyManager = new KeyManager();
  }

  public getLogsStorageKey(account?: string): string {
    const acc = account || this.accountName || 'guest';
    return `btsbots_audit_logs_${acc}`;
  }

  public getTransfersStorageKey(account?: string): string {
    const acc = account || this.accountName || 'guest';
    return `btsbots_transfers_${acc}`;
  }

  public loadPersistedLogs(account?: string): void {
    const key = this.getLogsStorageKey(account);
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        this.auditLogs = JSON.parse(stored);
      } else {
        this.auditLogs = [];
      }
    } catch {
      this.auditLogs = [];
    }
  }

  public log(text: string): void {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${text}`;
    this.auditLogs.push(entry);
    if (this.auditLogs.length > 500) this.auditLogs.shift();

    try {
      const key = this.getLogsStorageKey();
      localStorage.setItem(key, JSON.stringify(this.auditLogs));
    } catch {}

    if ((window as any).__onBtsLog) {
      (window as any).__onBtsLog(entry);
    }
  }

  public clearLogs(): void {
    this.auditLogs = [];
    localStorage.removeItem(this.getLogsStorageKey());
  }

  public getRulesStorageKey(account?: string): string {
    const acc = account || this.accountName || 'default';
    return `btsbots_security_rules_${acc}`;
  }

  public async loadRules(account?: string): Promise<SecurityRules> {
    const targetAccount = account || this.accountName || 'default';
    const key = this.getRulesStorageKey(targetAccount);
    const stored = localStorage.getItem(key);
    let parsedRules: SecurityRules | null = null;

    if (stored) {
      try {
        parsedRules = JSON.parse(stored);
      } catch (e) {
        console.error('Failed to parse stored rules for account:', e);
      }
    }

    if (!parsedRules) {
      try {
        const resp = await fetch('/default_rules.json');
        parsedRules = await resp.json();
        localStorage.setItem(key, JSON.stringify(parsedRules));
      } catch {
        parsedRules = {
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
    }

    this.rules = parsedRules!;
    await this.verifyRecipientWhitelistOnChain();
    return this.rules;
  }

  private async verifyRecipientWhitelistOnChain(): Promise<void> {
    if (!this.rules?.unlimited_payments?.recipient_whitelist) return;
    const recipients = this.rules.unlimited_payments.recipient_whitelist;

    for (const [username, ruleVal] of Object.entries(recipients)) {
      const claimedId = typeof ruleVal === 'object' ? ruleVal.id : ruleVal;
      try {
        const doc = await this.getAccountInfo(username);
        if (doc) {
          const chainId = `1.2.${doc._id}`;
          if (claimedId && chainId !== claimedId) {
            this.log(`🚨 [风控警告] 白名单账号 [${username}] 链上实际ID [${chainId}] 与配置的 [${claimedId}] 不匹配！`);
          }
        } else {
          this.log(`⚠️ [风控警告] 白名单账号 [${username}] 在链上不存在！`);
        }
      } catch {}
    }
  }

  public async saveRules(newRules: SecurityRules, account?: string): Promise<void> {
    this.rules = newRules;
    const key = this.getRulesStorageKey(account);
    localStorage.setItem(key, JSON.stringify(newRules, null, 2));
    this.log(`✓ 账号 [${account || this.accountName}] 的风控策略已保存至本地并完成热重载！`);
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

  public async getAssetBrief(symbolOrId: string): Promise<{ symbol: string; id: string; precision: number; rawDoc: any }> {
    if (!this.ddp.isConnected()) {
      await this.ddp.connect();
    }
    let assetDoc: any = null;
    if (symbolOrId.startsWith('1.3.')) {
      const rawNum = parseInt(symbolOrId.split('.')[2], 10);
      assetDoc = await this.ddp.call('get_asset_document_by_id', rawNum);
    } else {
      assetDoc = await this.ddp.call('get_asset_document_by_symbol', symbolOrId.toUpperCase().trim());
    }
    if (!assetDoc) {
      throw new Error(`链上未查找到资产 [${symbolOrId}]`);
    }
    return {
      symbol: assetDoc.symbol || symbolOrId,
      id: `1.3.${assetDoc._id}`,
      precision: assetDoc.p !== undefined ? assetDoc.p : (assetDoc.precision || 5),
      rawDoc: assetDoc,
    };
  }

  public async resolveActivePubkey(account: string): Promise<string> {
    const doc = await this.getAccountInfo(account);
    if (!doc) {
      throw new Error(`链上未查找到账号 [${account}]`);
    }
    const keysToCheck: string[] = [];
    if (doc.k?.a) keysToCheck.push(...doc.k.a);
    if (doc.active?.key_auths) {
      keysToCheck.push(...doc.active.key_auths.map((k: any) => k[0]));
    }

    for (const k of keysToCheck) {
      if (this.keyManager.hasKey(k)) {
        return k;
      }
    }
    throw new Error(`账号 [${account}] 的链上 Active Key 不存在于当前私钥库中`);
  }

  public async loginWithKeys(account: string, wifKeys: string[]): Promise<void> {
    this.keyManager.clear();
    for (const wif of wifKeys) {
      this.keyManager.addKeyByWif(wif);
    }
    this.accountName = account;

    this.loadPersistedLogs(account);

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

    await this.loadRules(account);
    this.log(`✓ [会话就绪] 账号: ${account} (ID: ${this.btsId})`);
  }

  public async startGateway(): Promise<void> {
    if (!this.accountName || !this.userId) {
      throw new Error('请先解锁并登录账号后再启动网关！');
    }
    await this.loadRules(this.accountName);
    this.isRunning = true;

    this.ddp.removeAllListeners('data_changed');
    this.inFlightDocs.clear();

    this.ddp.subscribe('chainBlockHeadStream');
    this.ddp.subscribe('chainGlobalProperties');
    this.ddp.subscribe('allPendingSignRequests');
    this.ddp.subscribe('pendingAccountRegistrations');

    this.ddp.on('data_changed', (action, collection, docId, fields) => {
      if (!this.isRunning) return;
      if (collection === 'proxy_sign_requests' && action === 'added') {
        this.handleProxySignRequest(docId, fields);
      } else if (collection === 'account_registrations' && action === 'added') {
        this.handleAccountRegistration(docId, fields);
      }
    });

    this.log('🛡️ 零信任签名网关已启动守护');
  }

  public stopGateway(): void {
    this.isRunning = false;
    this.ddp.removeAllListeners('data_changed');
    this.inFlightDocs.clear();
    this.log('⏹ 签名网关已停止');
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
      await this.ddp.connect();
    }

    await this.ddp.call('verifyInvitation', inviteCode);

    const existing = await this.ddp.call('get_account_document_by_symbol', newAccountName);
    if (existing) throw new Error(`用户名 [${newAccountName}] 已经被占用，请换一个！`);

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

    const subRes = await this.ddp.call('submitAccountRegistration', accountData);
    const regId = subRes.registrationId;

    return {
      regId,
      username: newAccountName,
      keys: [ownerPriv.toWif(), activePriv.toWif(), memoPriv.toWif()],
      credentialsContent: `${newAccountName}\nOwner WIF: ${ownerPriv.toWif()}\nActive WIF: ${activePriv.toWif()}\nMemo WIF: ${memoPriv.toWif()}\n`,
    };
  }

  private getBlockSyncInfo(): { headBlockNum: number; headBlockId: string; blockTime: number } {
    const blockHeadColl = this.ddp.collections.global_properties;
    if (!blockHeadColl || Object.keys(blockHeadColl).length === 0) {
      throw new Error('暂未同步到区块头状态数据 (global_properties)');
    }
    const blockDoc = Object.values(blockHeadColl)[0] as any;
    const headBlockNum = parseInt(blockDoc.B || blockDoc.head_block_number || 0, 10);
    const headBlockId = String(blockDoc.id || blockDoc.head_block_id || '').trim();
    const blockTime = (blockDoc.T?.$date || blockDoc.time || Date.now()) / 1000;

    return { headBlockNum, headBlockId, blockTime };
  }

  // 🌟 手续费计算（严格默认 0）
  private fillOpsFeeFromGlobal(tr: TransactionBuilder): void {
    const globalColl = this.ddp.collections.global || {};
    const globalDoc = Object.values(globalColl).find((doc: any) => doc.id === '2.0.0') as any;
    const feeParams = globalDoc?.parameters?.current_fees?.parameters || [];

    for (const op of tr.operations) {
      const opCode = op[0];
      const item = feeParams[opCode];
      let calculatedFee = 0;

      if (item && item[1]) {
        if (opCode === 5) {
          // account_create
          const basicFee = parseInt(item[1].basic_fee || 0, 10);
          const nameLen = new TextEncoder().encode(op[1].name || '').length;
          const totalBytes = 143 + nameLen;
          calculatedFee = basicFee + Math.floor((totalBytes * (item[1].price_per_kbyte || 0)) / 1024);
        } else if (opCode === 0) {
          // transfer
          const baseFee = parseInt(item[1].fee || 0, 10);
          let extra = 0;
          if (op[1].memo && op[1].memo.message) {
            const cipherBytes = hexToBuffer(op[1].memo.message);
            const totalBytes = 33 + 33 + 8 + 2 + cipherBytes.length;
            extra = Math.floor((totalBytes * (item[1].price_per_kbyte || 0)) / 1024);
          }
          calculatedFee = baseFee + extra;
        } else {
          calculatedFee = parseInt(item[1].fee || item[1].basic_fee || 0, 10);
        }
      }

      op[1].fee = {
        amount: calculatedFee,
        asset_id: '1.3.0',
      };
    }
  }

  public async makeTransaction(rawOps: any[], isSim = false): Promise<number | string> {
    const tr = new TransactionBuilder();

    for (const rawOp of rawOps) {
      const opType = rawOp.type;
      const opParams = rawOp.params || {};

      if (opType === 'transfer') {
        const toAccDoc = await this.getAccountInfo(opParams.to_account);
        if (!toAccDoc) throw new Error(`找不到转账目标账号 [${opParams.to_account}]`);
        const toId = `1.2.${toAccDoc._id}`;
        const assetBrief = await this.getAssetBrief(opParams.asset);
        const rawAmount = Math.round(parseFloat(opParams.amount) * Math.pow(10, assetBrief.precision));

        let memoObj: any = undefined;
        if (opParams.memo !== undefined && String(opParams.memo).trim() !== '') {
          // 1. 发送方公钥与私钥
          const myInfo = await this.getAccountInfo(this.accountName!);
          const myMemoPubStr = myInfo.k?.m || (await this.resolveActivePubkey(this.accountName!));

          let myMemoPKey = this.keyManager.getPrivateKey(myMemoPubStr);
          if (!myMemoPKey) {
            const activePub = await this.resolveActivePubkey(this.accountName!);
            myMemoPKey = this.keyManager.getPrivateKey(activePub);
          }
          if (!myMemoPKey) {
            throw new Error(`私钥库中未找到发送方 Memo 或 Active 私钥，无法加签附言`);
          }

          // 2. 接收方公钥
          const toMemoPubStr = toAccDoc.k?.m || toAccDoc.k?.a?.[0];
          if (!toMemoPubStr) {
            throw new Error(`目标收款账号 [${opParams.to_account}] 未提供有效公钥，无法加密 Memo`);
          }

          const toMemoPubKey = PublicKey.fromStringOrThrow(toMemoPubStr, "BTS");
          const nonce = String(Math.floor(Math.random() * 100000000000000));
          const cipherBuf = Aes.encrypt_with_checksum(myMemoPKey, toMemoPubKey, nonce, String(opParams.memo));
          const cipherHex = bufferToHex(cipherBuf);

          memoObj = {
            from: myMemoPubStr,
            to: toMemoPubStr,
            nonce,
            message: cipherHex,
          };
        }

        tr.add_type_operation('transfer', {
          fee: { amount: 0, asset_id: '1.3.0' },
          from: this.btsId,
          to: toId,
          amount: { amount: rawAmount, asset_id: assetBrief.id },
          memo: memoObj,
          extensions: [],
        });
      } else if (opType === 'limit_order_create') {
        const sellBrief = await this.getAssetBrief(opParams.sell_asset);
        const recvBrief = await this.getAssetBrief(opParams.receive_asset);
        const rawSellAmount = Math.round(parseFloat(opParams.amount) * Math.pow(10, sellBrief.precision));
        const rawRecvAmount = Math.round(parseFloat(opParams.amount) * parseFloat(opParams.price) * Math.pow(10, recvBrief.precision));

        tr.add_type_operation('limit_order_create', {
          fee: { amount: 0, asset_id: '1.3.0' },
          seller: this.btsId,
          amount_to_sell: { amount: rawSellAmount, asset_id: sellBrief.id },
          min_to_receive: { amount: rawRecvAmount, asset_id: recvBrief.id },
          expiration: '2100-01-01T00:00:00',
          fill_or_kill: 0,
          extensions: [],
        });
      } else if (opType === 'limit_order_cancel') {
        const orderIdStr = String(opParams.order_id).startsWith('1.7.') ? opParams.order_id : `1.7.${opParams.order_id}`;
        tr.add_type_operation('limit_order_cancel', {
          fee: { amount: 0, asset_id: '1.3.0' },
          fee_paying_account: this.btsId,
          order: orderIdStr,
          extensions: [],
        });
      } else if (opType === 'withdraw_vesting') {
        const assetBrief = await this.getAssetBrief(opParams.asset);
        const rawAmount = Math.round(parseFloat(opParams.amount) * Math.pow(10, assetBrief.precision));
        tr.add_type_operation('withdraw_vesting', {
          fee: { amount: 0, asset_id: '1.3.0' },
          vesting_balance: String(opParams.vesting_balance),
          owner: this.btsId,
          amount: { amount: rawAmount, asset_id: assetBrief.id },
        });
      } else if (opType === 'account_create') {
        tr.add_type_operation('account_create', {
          fee: { amount: 0, asset_id: '1.3.0' },
          registrar: this.btsId,
          referrer: this.btsId,
          referrer_percent: 10000,
          name: opParams.name,
          owner: {
            weight_threshold: 1,
            account_auths: [],
            key_auths: [[opParams.owner_key, 1]],
            address_auths: [],
          },
          active: {
            weight_threshold: 1,
            account_auths: [],
            key_auths: [[opParams.active_key, 1]],
            address_auths: [],
          },
          options: {
            memo_key: opParams.memo_key,
            voting_account: '1.2.0',
            num_witness: 0,
            num_committee: 0,
            votes: [],
          },
          extensions: [],
        });
      } else {
        throw new Error(`未支持的操作类型: ${opType}`);
      }
    }

    this.fillOpsFeeFromGlobal(tr);

    const { headBlockNum, headBlockId, blockTime } = this.getBlockSyncInfo();
    const activePub = await this.resolveActivePubkey(this.accountName!);
    const pKey = this.keyManager.getPrivateKey(activePub);
    if (!pKey) throw new Error(`未找到公钥 [${activePub}] 对应的私钥`);

    tr.add_signer(pKey, activePub);
    tr.ref_block_num = headBlockNum & 0xffff;
    tr.ref_block_prefix = Buffer.from(String(headBlockId), 'hex').readUInt32LE(4);
    tr.expiration = Math.ceil(blockTime + 300);

    tr.tr_buffer = ops.transaction.toBuffer(tr);
    tr.sign(BITSHARES_CHAIN_ID);

    const signedTxObject = ops.signed_transaction.toObject(tr);

    if (isSim) {
      return 1644;
    }

    let result = await this.ddp.call('broadcastTransaction', signedTxObject).catch(() => null);
    if (!result) {
      result = await this.ddp.call('broadcast', signedTxObject);
    }

    if (result && result.status === 'FAIL') {
      throw new Error(result.message || '交易广播被链上节点拒绝');
    }

    const blockNum = result?.blockNum || result?.block_num || 'Confirmed';
    return blockNum;
  }

  private async verifyBrowserEnvelope(envelope: any): Promise<{ valid: boolean; alias: string | null; msg: string }> {
    const txString = envelope.tx_string;
    const pubHex = envelope.browser_pubkey;
    const sigHex = envelope.browser_sig;

    if (!txString || !pubHex || !sigHex) {
      return { valid: false, alias: null, msg: '缺少标准 Web Crypto 鉴权参数' };
    }

    let fp50 = '';
    try {
      const h = hash.sha256(pubHex.toLowerCase());
      const hexStr = typeof h === 'string' ? h : (h && typeof h.toString === 'function' ? h.toString('hex') : String(h));
      fp50 = hexStr.slice(0, 50);
    } catch {
      fp50 = pubHex.slice(0, 50);
    }

    const publicKeysMap = this.rules?.public_keys || {};
    if (!publicKeysMap[fp50]) {
      return { valid: false, alias: null, msg: `未授权的设备公钥指纹: ${fp50}` };
    }

    const deviceAlias = publicKeysMap[fp50];

    try {
      const pubKeyBytes = hexToBuffer(pubHex);
      const sigBytes = hexToBuffer(sigHex);

      const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        pubKeyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );

      const isValid = await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        sigBytes,
        new TextEncoder().encode(txString)
      );

      if (!isValid) {
        return { valid: false, alias: deviceAlias, msg: '密码学签名验证错误' };
      }
    } catch (e: any) {
      return { valid: false, alias: deviceAlias, msg: `密码学验签异常: ${e.message}` };
    }

    try {
      const rawPayload = JSON.parse(txString);
      const clientTime = rawPayload.client_time || 0;
      if (clientTime > 0 && Math.abs(Math.floor(Date.now() / 1000) - clientTime) > 30) {
        return { valid: false, alias: deviceAlias, msg: '交易请求已过期 (超过30秒)' };
      }
    } catch {
      return { valid: false, alias: deviceAlias, msg: '无法解析交易内容 JSON' };
    }

    if (this.seenSignatures.has(sigHex)) {
      return { valid: false, alias: deviceAlias, msg: '检测到重复提交的交易签名' };
    }
    this.seenSignatures.add(sigHex);

    return { valid: true, alias: deviceAlias, msg: '签名可信' };
  }

  private checkMicroPaymentAccumulated(accountId: string, deviceAlias: string, asset: string, amount: number, dayMax: number, weekMax: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 86400;
    const weekAgo = now - 604800;

    let transfers: TransferRecord[] = [];
    try {
      const raw = localStorage.getItem(this.getTransfersStorageKey());
      if (raw) transfers = JSON.parse(raw);
    } catch {
      transfers = [];
    }

    const daySum = transfers
      .filter((t) => t.accountId === accountId && t.deviceAlias === deviceAlias && t.asset === asset && t.timestamp >= dayAgo)
      .reduce((sum, t) => sum + t.amount, 0);

    if (daySum + amount > dayMax) return false;

    const weekSum = transfers
      .filter((t) => t.accountId === accountId && t.deviceAlias === deviceAlias && t.asset === asset && t.timestamp >= weekAgo)
      .reduce((sum, t) => sum + t.amount, 0);

    if (weekSum + amount > weekMax) return false;

    return true;
  }

  private logSuccessfulTransfer(accountId: string, deviceAlias: string, asset: string, amount: number): void {
    let transfers: TransferRecord[] = [];
    const key = this.getTransfersStorageKey();
    try {
      const raw = localStorage.getItem(key);
      if (raw) transfers = JSON.parse(raw);
    } catch {
      transfers = [];
    }

    transfers.push({
      accountId,
      deviceAlias,
      asset: asset.toUpperCase().trim(),
      amount,
      timestamp: Math.floor(Date.now() / 1000),
    });

    if (transfers.length > 500) transfers = transfers.slice(-500);
    localStorage.setItem(key, JSON.stringify(transfers));
  }

  private async auditSecurityStrategy(
    opType: string,
    params: any,
    senderId: string,
    deviceAlias: string,
    pinCodeProvided?: string
  ): Promise<{ safe: boolean; statusMsg: string; requirePin: boolean; matchedStrategy: string }> {
    if (opType === 'withdraw_vesting') {
      const authorizedDevices = this.rules?.unlimited_payments?.authorized_devices || [];
      if (!authorizedDevices.includes(deviceAlias)) {
        return { safe: false, statusMsg: `设备 [${deviceAlias}] 未授权执行分红提现`, requirePin: false, matchedStrategy: '提现权限风控' };
      }
      return { safe: true, statusMsg: '通过【分红提现授权策略】', requirePin: false, matchedStrategy: '提现分红' };
    }

    if (opType === 'transfer') {
      const unlimitedCfg = this.rules?.unlimited_payments || { authorized_devices: [], recipient_whitelist: {} };
      const authorizedDevices = unlimitedCfg.authorized_devices || [];
      const recipientWhitelist = unlimitedCfg.recipient_whitelist || {};
      const toAccountName = params.to_account;
      const memoProvided = String(params.memo || '').trim();

      // 1. 先匹配大额官方收款人白名单
      if (authorizedDevices.includes(deviceAlias) && recipientWhitelist[toAccountName]) {
        const whiteRule = recipientWhitelist[toAccountName];
        const requiredMemo = typeof whiteRule === 'object' ? (whiteRule.required_memo || '').trim() : '';

        if (requiredMemo !== '') {
          if (!memoProvided || !memoProvided.includes(requiredMemo)) {
            return {
              safe: false,
              statusMsg: `白名单收款人 [${toAccountName}] 要求必填附言: "${requiredMemo}"，当前附言为: "${memoProvided || '无'}"`,
              requirePin: false,
              matchedStrategy: '限定Memo白名单保护',
            };
          }
        }

        return { safe: true, statusMsg: `命中【大额白名单策略】(收款人: ${toAccountName})`, requirePin: false, matchedStrategy: '大额白名单' };
      }

      // 2. 匹配小额微支付阶梯策略
      const microCfg = this.rules?.micro_payments || { base_limits: {}, device_rules: {} };
      const baseLimits = microCfg.base_limits || {};
      const deviceRules = microCfg.device_rules || {};

      if (!deviceRules[deviceAlias]) {
        return {
          safe: false,
          statusMsg: `设备 [${deviceAlias}] 不在大额白名单设备中，亦未配置小额免密规则`,
          requirePin: false,
          matchedStrategy: '未授权设备',
        };
      }

      const devRule = deviceRules[deviceAlias];
      const asset = (params.asset || '').toUpperCase().trim();
      const amount = parseFloat(params.amount || '0');

      const baseLimit = baseLimits[asset] || 0;
      if (baseLimit === 0) {
        return { safe: false, statusMsg: `资产 [${asset}] 未配置单笔基准限额`, requirePin: false, matchedStrategy: '未定义资产' };
      }

      const singleLimit = baseLimit * (devRule.single_multiplier || 1);
      const dayLimit = baseLimit * (devRule.day_max_multiplier || 1);
      const weekLimit = baseLimit * (devRule.week_max_multiplier || 1);

      if (amount > singleLimit) {
        return {
          safe: false,
          statusMsg: `转账金额 ${amount} ${asset} 超出该设备单笔小额限额 (${singleLimit} ${asset})`,
          requirePin: false,
          matchedStrategy: '小额单笔超限',
        };
      }

      if (!this.checkMicroPaymentAccumulated(senderId, deviceAlias, asset, amount, dayLimit, weekLimit)) {
        return {
          safe: false,
          statusMsg: `转账金额超出该设备【天累计限额: ${dayLimit}】或【周累计限额: ${weekLimit}】`,
          requirePin: false,
          matchedStrategy: '小额累计超限',
        };
      }

      const requiredPin = devRule.pin;
      if (requiredPin !== undefined && String(requiredPin).trim() !== '') {
        if (!pinCodeProvided) {
          return { safe: false, statusMsg: '该操作需要输入设备 PIN 码验证', requirePin: true, matchedStrategy: '需要PIN码' };
        } else if (String(pinCodeProvided).trim() !== String(requiredPin).trim()) {
          return { safe: false, statusMsg: '输入的 PIN 码错误', requirePin: false, matchedStrategy: 'PIN码错误' };
        }
      }

      return { safe: true, statusMsg: `命中【小额免密策略】(单笔限额: ${singleLimit} ${asset})`, requirePin: false, matchedStrategy: '小额免密' };
    }

    if (opType === 'limit_order_create') {
      const tradingCfg = this.rules?.trading_risk || { authorized_devices: [], market_whitelist: [] };
      const authorizedDevices = tradingCfg.authorized_devices || [];
      const marketWhitelist = tradingCfg.market_whitelist || [];

      if (!authorizedDevices.includes(deviceAlias)) {
        return { safe: false, statusMsg: `设备 [${deviceAlias}] 未被授权挂单交易`, requirePin: false, matchedStrategy: '挂单权限风控' };
      }

      const pair = `${(params.sell_asset || '').toUpperCase()}/${(params.receive_asset || '').toUpperCase()}`;
      const revPair = `${(params.receive_asset || '').toUpperCase()}/${(params.sell_asset || '').toUpperCase()}`;
      if (!marketWhitelist.includes(pair) && !marketWhitelist.includes(revPair)) {
        return { safe: false, statusMsg: `市场 [${pair}] 未在交易对白名单中`, requirePin: false, matchedStrategy: '市场白名单拦截' };
      }

      return { safe: true, statusMsg: `命中【市场交易白名单】(${pair})`, requirePin: false, matchedStrategy: '交易白名单' };
    }

    if (opType === 'limit_order_cancel') {
      return { safe: true, statusMsg: '撤单操作安全策略校验通过', requirePin: false, matchedStrategy: '撤单策略' };
    }

    return { safe: true, statusMsg: '操作安全策略校验通过', requirePin: false, matchedStrategy: '默认放行' };
  }

  private formatOpDetails(opType: string, p: any): string {
    if (opType === 'transfer') {
      const memoText = p.memo ? ` | 附言: "${p.memo}"` : '';
      return `转账 ${p.amount} ${p.asset} ➜ ${p.to_account}${memoText}`;
    }
    if (opType === 'limit_order_create') {
      return `限价挂单: 卖出 ${p.amount} ${p.sell_asset} ➜ 买入 ${p.receive_asset} (价格: ${p.price})`;
    }
    if (opType === 'limit_order_cancel') {
      return `取消订单 ID: ${p.order_id}`;
    }
    if (opType === 'withdraw_vesting') {
      return `提取分红: ${p.amount} ${p.asset} (余额ID: ${p.vesting_balance})`;
    }
    if (opType === 'oauth_login') {
      return `OAuth 授权登录 ➜ 目标站点: [${p.site}] (客户端IP: ${p.ip})`;
    }
    return `${opType} ${JSON.stringify(p)}`;
  }

  private async handleProxySignRequest(docId: string, fields: any): Promise<void> {
    if (this.inFlightDocs.has(docId)) return;
    this.inFlightDocs.add(docId);

    try {
      const envelope = fields.rawTx || {};
      const authenticatedSenderId = fields.account_id || this.btsId || '';

      const { valid: isValidCrypto, alias: deviceAlias, msg: cryptoMsg } = await this.verifyBrowserEnvelope(envelope);

      let rawPayload: any = {};
      try {
        rawPayload = JSON.parse(envelope.tx_string || '{}');
      } catch {
        rawPayload = {};
      }

      const opType = rawPayload.type || 'unknown';
      const opParams = rawPayload.params || {};
      const opSummary = this.formatOpDetails(opType, opParams);

      this.log(`──────── 📥 收到请求 [${opType}] ────────`);
      this.log(`📱 发起设备: [${deviceAlias || '未识别设备'}] | 操作: ${opSummary}`);

      if (!isValidCrypto) {
        this.log(`❌ 拒绝签名: ${cryptoMsg}`);
        this.log(`─────────────────────────────────────────`);
        await this.ddp.call('replySignRequest', false, docId, cryptoMsg).catch(() => {});
        return;
      }

      const pinCodeProvided = opParams.pin;

      if (opType === 'oauth_login') {
        const oauthDevices = this.rules?.oauth_allowed_devices || [];
        if (!oauthDevices.includes(deviceAlias!)) {
          const reason = `设备 [${deviceAlias}] 未在 OAuth 允许授权列表中`;
          this.log(`❌ 拒绝授权: ${reason}`);
          this.log(`─────────────────────────────────────────`);
          await this.ddp.call('replySignRequest', false, docId, reason).catch(() => {});
          return;
        }

        this.log(`✓ 放行: 命中【OAuth 设备授权白名单】`);
        await this.oauthHandle(docId, fields, opParams);
        this.log(`─────────────────────────────────────────`);
        return;
      }

      const { safe: isSafe, statusMsg, requirePin } = await this.auditSecurityStrategy(
        opType,
        opParams,
        authenticatedSenderId,
        deviceAlias!,
        pinCodeProvided
      );

      if (requirePin) {
        this.log(`⚠️ 安全验证: ${statusMsg}`);
        this.log(`─────────────────────────────────────────`);
        await this.ddp.call('replySignRequest', false, docId, { requirePin: true, message: statusMsg }).catch(() => {});
        return;
      }

      if (!isSafe) {
        this.log(`❌ 拦截拒绝: ${statusMsg}`);
        this.log(`─────────────────────────────────────────`);
        await this.ddp.call('replySignRequest', false, docId, statusMsg).catch(() => {});
        return;
      }

      this.log(`✓ 放行: ${statusMsg}`);

      try {
        const blockNum = await this.makeTransaction([rawPayload], !!opParams.simulate);

        if (opType === 'transfer') {
          this.logSuccessfulTransfer(authenticatedSenderId, deviceAlias!, opParams.asset, parseFloat(opParams.amount || '0'));
        }

        await this.ddp.call('replySignRequest', true, docId, blockNum);
        this.log(`🎉 签名成功并上链确认！区块号: #${blockNum}`);
      } catch (e: any) {
        this.log(`🚨 广播失败: ${e.message}`);
        await this.ddp.call('replySignRequest', false, docId, e.message).catch(() => {});
      }
      this.log(`─────────────────────────────────────────`);
    } finally {
      this.inFlightDocs.delete(docId);
    }
  }

  private async oauthHandle(docId: string, fields: any, opParams: any): Promise<void> {
    const clientIp = fields.clientIp;
    const clientId = opParams.client_id;
    const token = opParams.token;
    const site = opParams.site;
    const ip = opParams.ip;

    if (!clientId || !token || !site || !ip) {
      const msg = '授权登录参数不完整';
      this.log(`❌ 授权失败: ${msg}`);
      await this.ddp.call('replySignRequest', false, docId, msg).catch(() => {});
      return;
    }

    if (clientIp && clientIp !== ip) {
      const msg = `IP 地址不符 (网关 IP: ${clientIp}, 声明 IP: ${ip})`;
      this.log(`❌ 授权拦截: ${msg}`);
      await this.ddp.call('replySignRequest', false, docId, msg).catch(() => {});
      return;
    }

    try {
      const activePub = await this.resolveActivePubkey(this.accountName!);
      const authData = {
        username: this.accountName,
        site,
        ip,
        token,
        time: Math.floor(Date.now() / 1000),
      };
      const messageStr = JSON.stringify(authData);
      const signRes = this.keyManager.signMessage(activePub, messageStr);

      const finalPayload = {
        client_id: String(clientId).toLowerCase().trim(),
        verify: signRes,
      };

      await this.ddp.call('pushAuthToMerchantQueue', finalPayload);
      await this.ddp.call('replySignRequest', true, docId, token);
      this.log(`✅ [OAuth 授权完成] 站点 [${site}] 已成功获签登录凭证`);
    } catch (e: any) {
      const errorMsg = `OAuth 签名或推送异常: ${e.message}`;
      this.log(`❌ 授权失败: ${errorMsg}`);
      await this.ddp.call('replySignRequest', false, docId, errorMsg).catch(() => {});
    }
  }

  private async handleAccountRegistration(docId: string, fields: any): Promise<any> {
    if (fields.registrar !== this.accountName) return;
    this.log(`──────── 👤 收到注册代办申请 ────────`);
    this.log(`新账户名: [${fields.newAccountName}]`);

    try {
      const rawOp = {
        type: 'account_create',
        params: {
          name: fields.newAccountName,
          owner_key: fields.keys?.owner,
          active_key: fields.keys?.active,
          memo_key: fields.keys?.memo,
        },
      };

      const blockNum = await this.makeTransaction([rawOp], false);
      await this.ddp.call('resolveAccountRegistration', docId, true, `Block: ${blockNum}`);
      this.log(`🎉 注册成功！已写入区块链，区块号: #${blockNum}`);
    } catch (e: any) {
      this.log(`❌ 注册代办失败: ${e.message}`);
      await this.ddp.call('resolveAccountRegistration', docId, false, e.message);
    }
    this.log(`─────────────────────────────────────────`);
  }
}

export const signBotsEngine = new SignBotsEngine();
