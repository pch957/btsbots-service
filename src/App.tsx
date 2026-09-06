import React, { useState, useEffect, useRef } from 'react';
import { i18n } from './i18n/locales';
import { KeystoreManager } from './core/keystore';
import { signBotsEngine } from './core/signBots';
import { copyToClipboard } from './core/utils';
import { SecurityRules } from './types/rules';

const SCREEN_PIN_KEY = 'btsbots_screen_pin';
const SESSION_ACCOUNT_KEY = 'btsbots_session_account';
const SESSION_KEYS_KEY = 'btsbots_session_keys';
const SESSION_LOCKED_KEY = 'btsbots_screen_locked';
const AUTO_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟无操作自动锁屏

function downloadFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [lang, setLang] = useState<'zh' | 'en' | 'ru'>('zh');
  const [activeTab, setActiveTab] = useState<'gateway' | 'otp' | 'rules' | 'logs'>('gateway');
  const [rulesSubTab, setRulesSubTab] = useState<'devices' | 'unlimited' | 'micro' | 'trading'>('devices');

  // 🌟 惰性同步初始化状态（彻底消灭刷新界面的闪烁，锁定状态严密保持）
  const [currentAccount, setCurrentAccount] = useState<string | null>(() => {
    return sessionStorage.getItem(SESSION_ACCOUNT_KEY);
  });
  const [activeKeys, setActiveKeys] = useState<string[]>(() => {
    const raw = sessionStorage.getItem(SESSION_KEYS_KEY);
    if (raw) {
      try { return JSON.parse(raw); } catch {}
    }
    return [];
  });
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    return !!sessionStorage.getItem(SESSION_ACCOUNT_KEY);
  });
  const [isScreenLocked, setIsScreenLocked] = useState<boolean>(() => {
    return sessionStorage.getItem(SESSION_LOCKED_KEY) === '1';
  });

  const [hasKeystore, setHasKeystore] = useState(() => KeystoreManager.exists());
  const [savedAccount, setSavedAccount] = useState<string | null>(() => KeystoreManager.getSavedAccountName());
  const [authMode, setAuthMode] = useState<'unlock' | 'import' | 'register'>(() => {
    return KeystoreManager.exists() ? 'unlock' : 'import';
  });

  const [isGwRunning, setIsGwRunning] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // 锁屏与 PIN 状态
  const [hasPinSet, setHasPinSet] = useState(() => !!localStorage.getItem(SCREEN_PIN_KEY));
  const [pinInput, setPinInput] = useState('');
  const [showSetPinModal, setShowSetPinModal] = useState(false);
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');

  // 账号表单
  const [unlockPassword, setUnlockPassword] = useState('');
  const [importFileContent, setImportFileContent] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rulesFileInputRef = useRef<HTMLInputElement>(null);

  const [regInvite, setRegInvite] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // OTP
  const [otpCode, setOtpCode] = useState('--------');
  const [otpTimer, setOtpTimer] = useState<number | null>(null);

  // Rules State
  const [rules, setRules] = useState<SecurityRules | null>(null);
  const [logs, setLogs] = useState<string[]>(() => {
    const acc = sessionStorage.getItem(SESSION_ACCOUNT_KEY);
    if (acc) {
      signBotsEngine.loadPersistedLogs(acc);
      return [...signBotsEngine.auditLogs];
    }
    return [];
  });
  const [newMarket, setNewMarket] = useState('');

  // 自动滚屏
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);

  const lastActivityRef = useRef<number>(Date.now());
  const isUnlockedRef = useRef<boolean>(isUnlocked);
  const isScreenLockedRef = useRef<boolean>(isScreenLocked);

  const t = i18n[lang];

  useEffect(() => {
    isUnlockedRef.current = isUnlocked;
    isScreenLockedRef.current = isScreenLocked;
    if (isScreenLocked) {
      sessionStorage.setItem(SESSION_LOCKED_KEY, '1');
    } else {
      sessionStorage.removeItem(SESSION_LOCKED_KEY);
    }
  }, [isUnlocked, isScreenLocked]);

  // 页面加载时恢复网关会话
  useEffect(() => {
    (window as any).__onBtsLog = (msg: string) => {
      setLogs((prev) => [...prev.slice(-499), msg]);
    };

    const sessAcc = sessionStorage.getItem(SESSION_ACCOUNT_KEY);
    const sessKeysRaw = sessionStorage.getItem(SESSION_KEYS_KEY);

    if (sessAcc && sessKeysRaw) {
      try {
        const sessKeys = JSON.parse(sessKeysRaw);
        if (Array.isArray(sessKeys) && sessKeys.length > 0) {
          signBotsEngine.loginWithKeys(sessAcc, sessKeys).then(async () => {
            const accRules = await signBotsEngine.loadRules(sessAcc);
            setRules(accRules);
            await signBotsEngine.startGateway();
            setIsGwRunning(true);
          }).catch((err) => {
            console.error('Auto resume session error:', err);
          });
        }
      } catch (e) {
        console.error('Parse session keys error:', e);
      }
    }

    const updateActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach((ev) => window.addEventListener(ev, updateActivity, { passive: true }));

    const timer = setInterval(() => {
      if (isUnlockedRef.current && !isScreenLockedRef.current) {
        if (Date.now() - lastActivityRef.current >= AUTO_LOCK_TIMEOUT_MS) {
          setIsScreenLocked(true);
        }
      }
    }, 3000);

    return () => {
      activityEvents.forEach((ev) => window.removeEventListener(ev, updateActivity));
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'logs' && autoScrollLogs) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab, autoScrollLogs]);

  useEffect(() => {
    if (otpTimer && otpTimer > 0) {
      const timer = setTimeout(() => setOtpTimer(otpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [otpTimer]);

  const handleLockScreenBtn = () => {
    if (!localStorage.getItem(SCREEN_PIN_KEY)) {
      setShowSetPinModal(true);
    } else {
      setIsScreenLocked(true);
      setPinInput('');
    }
  };

  const handleSavePin = () => {
    if (!newPinInput || newPinInput.length < 4) {
      return alert('PIN 码长度不能少于 4 位数字！');
    }
    if (newPinInput !== confirmPinInput) {
      return alert('两次输入的 PIN 码不一致！');
    }
    localStorage.setItem(SCREEN_PIN_KEY, newPinInput);
    setHasPinSet(true);
    setShowSetPinModal(false);
    setNewPinInput('');
    setConfirmPinInput('');
    alert('✓ 安全 PIN 码设置成功！5分钟闲置后将自动锁屏。');
    setIsScreenLocked(true);
  };

  const handleUnlockPin = () => {
    const savedPin = localStorage.getItem(SCREEN_PIN_KEY);
    if (pinInput === savedPin) {
      setIsScreenLocked(false);
      setPinInput('');
      lastActivityRef.current = Date.now();
    } else {
      alert('PIN 码错误，请重新输入！');
      setPinInput('');
    }
  };

  const handleForgotPin = () => {
    if (!confirm('忘记 PIN 码将清除本地 PIN，立即断开与服务器的会话并擦除已解密密钥。确定重置吗？')) {
      return;
    }
    localStorage.removeItem(SCREEN_PIN_KEY);
    setHasPinSet(false);
    setIsScreenLocked(false);
    setPinInput('');
    handleLogout();
  };

  const handleLogout = () => {
    if (isGwRunning) {
      signBotsEngine.stopGateway();
      setIsGwRunning(false);
    }
    sessionStorage.removeItem(SESSION_ACCOUNT_KEY);
    sessionStorage.removeItem(SESSION_KEYS_KEY);
    sessionStorage.removeItem(SESSION_LOCKED_KEY);

    signBotsEngine.keyManager.clear();
    signBotsEngine.ddp.close();
    setIsUnlocked(false);
    setCurrentAccount(null);
    setActiveKeys([]);
    setLogs([]);
    setUnlockPassword('');
    setAuthMode(hasKeystore ? 'unlock' : 'import');
  };

  const onLoginSuccess = async (account: string, keys: string[]) => {
    setCurrentAccount(account);
    setActiveKeys(keys);
    setIsUnlocked(true);
    setIsLoggingIn(false);
    lastActivityRef.current = Date.now();

    sessionStorage.setItem(SESSION_ACCOUNT_KEY, account);
    sessionStorage.setItem(SESSION_KEYS_KEY, JSON.stringify(keys));

    signBotsEngine.loadPersistedLogs(account);
    setLogs([...signBotsEngine.auditLogs]);

    const accRules = await signBotsEngine.loadRules(account);
    setRules(accRules);

    try {
      await signBotsEngine.startGateway();
      setIsGwRunning(true);
    } catch (e: any) {
      console.error('Auto start gateway failed:', e);
    }
  };

  const handleUnlock = async () => {
    if (!unlockPassword) return alert('请输入解锁口令！');
    setIsLoggingIn(true);
    try {
      const creds = await KeystoreManager.loadCredentials(unlockPassword);
      await signBotsEngine.loginWithKeys(creds.account, creds.keys);
      setUnlockPassword('');
      await onLoginSuccess(creds.account, creds.keys);
    } catch (e: any) {
      setIsLoggingIn(false);
      alert(`解锁失败: ${e.message}`);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      setImportFileContent(evt.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleImportSave = async () => {
    if (!importFileContent || !importPassword) {
      return alert('请先选择凭据文件并输入保护口令！');
    }
    const lines = importFileContent.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return alert('凭据文件为空！');
    const account = lines[0];
    const keys: string[] = [];
    for (const line of lines.slice(1)) {
      const clean = line.includes(':') ? line.split(':').pop()!.trim() : line.trim();
      if (clean.startsWith('5') && clean.length >= 50) {
        keys.push(clean);
      }
    }
    if (keys.length === 0) return alert('未从文件中识别到有效 WIF 私钥！');

    setIsLoggingIn(true);
    try {
      await KeystoreManager.saveCredentials(importPassword, account, keys);
      setHasKeystore(true);
      setSavedAccount(account);
      await signBotsEngine.loginWithKeys(account, keys);

      setImportPassword('');
      setImportFileContent('');
      setImportFileName('');

      await onLoginSuccess(account, keys);
      alert(`🎉 凭据导入成功！已自动为您启动签名网关。当前账号: ${account}`);
    } catch (err: any) {
      setIsLoggingIn(false);
      alert(`导入失败: ${err.message}`);
    }
  };

  // 🌟 注册逻辑重构：保存加密私钥 -> 自动下载备份 -> 引导至登录界面手动解锁
  const handleRegister = async () => {
    if (!regInvite || !regUsername || !regPassword) {
      return alert('请完整填写邀请码、新用户名和保护密码！');
    }
    setIsLoggingIn(true);
    try {
      const res = await signBotsEngine.registerAccount(regInvite, regUsername);
      await KeystoreManager.saveCredentials(regPassword, res.username, res.keys);

      // 更新本地已存金库状态
      setHasKeystore(true);
      setSavedAccount(res.username);

      // 下载备份文件
      downloadFile(`${res.username}_credentials.txt`, res.credentialsContent);

      // 清空注册表单并切换回【口令解锁】登录模式
      const registeredName = res.username;
      setRegPassword('');
      setRegInvite('');
      setRegUsername('');
      setIsLoggingIn(false);
      setAuthMode('unlock');

      alert(
        `🎉 账号 [${registeredName}] 注册成功！\n\n` +
        `1. 私钥凭据已安全存入本地金库。\n` +
        `2. 已为您自动下载备份文件: ${registeredName}_credentials.txt\n\n` +
        `链上数据正在出块同步，请在当前登录界面输入您的保护密码解锁并启动网关。`
      );
    } catch (e: any) {
      setIsLoggingIn(false);
      alert(`注册失败: ${e.message}`);
    }
  };

  const handleExportCurrentCredentials = () => {
    if (!currentAccount || activeKeys.length === 0) {
      return alert('请先解锁账号！');
    }
    const content = `${currentAccount}\n` + activeKeys.map((k, i) => `Key ${i + 1}: ${k}`).join('\n') + '\n';
    downloadFile(`${currentAccount}_credentials_backup.txt`, content);
    alert(`✓ [${currentAccount}] 凭据已成功导出备份文件！`);
  };

  const toggleGateway = async () => {
    if (!isUnlocked) return alert('请先解锁账号！');
    if (!isGwRunning) {
      try {
        await signBotsEngine.startGateway();
        setIsGwRunning(true);
      } catch (e: any) {
        alert(`启动失败: ${e.message}`);
      }
    } else {
      signBotsEngine.stopGateway();
      setIsGwRunning(false);
    }
  };

  const fetchOtp = async () => {
    if (!isUnlocked) return alert('请先解锁账号！');
    try {
      setOtpCode('........');
      const res = await signBotsEngine.requestOtp();
      setOtpCode(res.otp);
      setOtpTimer(res.expires);
    } catch (e: any) {
      setOtpCode('FAILED');
      alert(`获取 OTP 失败: ${e.message}`);
    }
  };

  const handleCopyOtp = async () => {
    if (!otpCode || otpCode.includes('-') || otpCode === '........') return;
    const ok = await copyToClipboard(otpCode);
    if (ok) {
      alert(`✓ 已复制 8 位 OTP 验证码: ${otpCode}`);
    } else {
      alert(`复制失败，请手动记录: ${otpCode}`);
    }
  };

  const saveRulesToLocal = async () => {
    if (!rules || !currentAccount) return;
    await signBotsEngine.saveRules(rules, currentAccount);
    alert(`✓ 账号 [${currentAccount}] 的风控策略已成功保存并热重载生效！`);
  };

  const exportRulesJson = () => {
    if (!rules || !currentAccount) return;
    downloadFile(`security_rules_${currentAccount}.json`, JSON.stringify(rules, null, 2));
    alert(`✓ 账号 [${currentAccount}] 的风控策略文件已成功导出！`);
  };

  const handleImportRulesJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentAccount) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (!parsed.public_keys || !parsed.trading_risk) {
          throw new Error('JSON 数据结构缺少必要的风控字段！');
        }
        setRules(parsed);
        signBotsEngine.saveRules(parsed, currentAccount);
        alert(`✓ 账号 [${currentAccount}] 的风控策略文件导入并热重载成功！`);
      } catch (err: any) {
        alert(`导入 JSON 失败: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const getKnownAliases = () => {
    return Object.values(rules?.public_keys || {});
  };

  const handleLogClick = async (logText: string) => {
    const fpMatch = logText.match(/未授权的设备(?:公钥)?指纹:?\s*([a-fA-F0-9]{50})/);
    if (fpMatch && fpMatch[1]) {
      const fingerprint = fpMatch[1];
      await copyToClipboard(fingerprint);
      alert(`✓ 已直接复制未授权设备指纹:\n${fingerprint}\n\n您可前往【风控策略配置 -> 设备管理】中粘贴并添加该设备！`);
      return;
    }

    await copyToClipboard(logText);
    alert(`已复制该行日志:\n${logText}`);
  };

  return (
    <div className="flex flex-col h-screen bg-[#0b0f19] text-slate-100 relative overflow-hidden select-none">
      {/* 1. 锁屏全屏遮罩 */}
      {isScreenLocked && (
        <div className="fixed inset-0 z-[9999] bg-[#0b0f19] flex flex-col items-center justify-center p-6 space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-blue-600/10 border border-blue-500/20 text-blue-400 flex items-center justify-center text-3xl shadow-xl shadow-blue-500/10">
            🔒
          </div>
          <div className="text-center space-y-1">
            <h2 className="text-xl font-bold">屏幕已锁定</h2>
            <p className="text-xs text-slate-400">已触发闲置安全保护，请输入 PIN 码解锁</p>
          </div>

          <div className="w-full max-w-xs space-y-4">
            <input
              type="password"
              maxLength={8}
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlockPin()}
              placeholder="输入 4-8 位 PIN 码"
              className="w-full text-center text-lg tracking-[0.3em] bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleUnlockPin}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-3 rounded-xl shadow-md transition cursor-pointer"
            >
              解锁屏幕
            </button>

            <div className="text-center pt-2">
              <button
                onClick={handleForgotPin}
                className="text-xs text-rose-400 hover:text-rose-300 transition cursor-pointer"
              >
                忘记 PIN 码 / 重置并退出会话
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 设置 PIN 弹窗 */}
      {showSetPinModal && (
        <div className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#151d30] border border-slate-700 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold flex items-center space-x-2">
                <span>🔐</span>
                <span>设置安全锁屏 PIN 码</span>
              </h3>
              <button onClick={() => setShowSetPinModal(false)} className="text-slate-400 hover:text-slate-200 cursor-pointer">
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              设置 PIN 码后可随时主动锁屏，系统在 5 分钟闲置无操作后将自动锁定以防他人窥屏。
            </p>

            <div className="space-y-3">
              <input
                type="password"
                maxLength={8}
                placeholder="设置新 PIN (4-8 位数字)"
                value={newPinInput}
                onChange={(e) => setNewPinInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-center"
              />
              <input
                type="password"
                maxLength={8}
                placeholder="确认 PIN 码"
                value={confirmPinInput}
                onChange={(e) => setConfirmPinInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-center"
              />
            </div>

            <button
              onClick={handleSavePin}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2.5 rounded-xl shadow-md transition cursor-pointer"
            >
              保存并立即锁定
            </button>
          </div>
        </div>
      )}

      {/* 顶部导航 */}
      <header className="bg-[#111827] border-b border-slate-800 px-6 py-2.5 flex items-center justify-between shadow-lg z-10">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-600 text-white p-2 rounded-xl shadow-md">
            🛡️
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide flex items-center space-x-2">
              <span>{t.app_title}</span>
              <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30">
                Zero-Trust Daemon
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">{t.app_subtitle}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {isUnlocked && (
            <>
              <button
                onClick={handleLockScreenBtn}
                className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-xl shadow-md transition cursor-pointer"
                title={hasPinSet ? '点击立即锁屏' : '设置锁屏 PIN 码'}
              >
                <span>🔒</span>
                <span>{hasPinSet ? '锁屏' : '设PIN锁屏'}</span>
              </button>

              <div className="flex items-center space-x-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                <div className={`w-2.5 h-2.5 rounded-full ${isGwRunning ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 leading-tight">{t.engine_indicator}</span>
                  <span className={`text-[11px] font-bold leading-tight ${isGwRunning ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isGwRunning ? t.engine_online : t.engine_offline}
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-semibold text-emerald-400 font-mono">
                  {currentAccount}
                </span>
              </div>

              <button
                onClick={handleLogout}
                className="text-xs text-rose-400 hover:text-rose-300 px-2.5 py-1 rounded-lg border border-rose-500/20 bg-rose-500/10 cursor-pointer"
              >
                {t.btn_logout}
              </button>
            </>
          )}

          <div className="relative inline-block">
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as any)}
              className="appearance-none bg-[#1e293b] border border-slate-700 text-slate-100 text-xs rounded-xl px-3 py-1.5 pr-7 focus:outline-none cursor-pointer"
              style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}
            >
              <option value="zh" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>🇨🇳 简体中文</option>
              <option value="en" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>🇺🇸 English</option>
              <option value="ru" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>🇷🇺 Русский</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400 text-[10px]">
              ▼
            </div>
          </div>
        </div>
      </header>

      {/* 未登录门禁卡片 */}
      {!isUnlocked ? (
        <div className="flex-1 flex items-center justify-center p-6 bg-[#090d16]">
          <div className="bg-[#121929] border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 text-blue-400 mx-auto flex items-center justify-center text-2xl shadow-lg">
                🔑
              </div>
              <h2 className="text-lg font-bold">{t.login_gate_title}</h2>
              <p className="text-xs text-slate-400">{t.login_gate_desc}</p>
            </div>

            <div className="flex bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
              {hasKeystore && (
                <button
                  disabled={isLoggingIn}
                  onClick={() => setAuthMode('unlock')}
                  className={`flex-1 py-2 rounded-lg transition cursor-pointer ${
                    authMode === 'unlock' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.tab_unlock}
                </button>
              )}
              <button
                disabled={isLoggingIn}
                onClick={() => setAuthMode('import')}
                className={`flex-1 py-2 rounded-lg transition cursor-pointer ${
                  authMode === 'import' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.tab_import}
              </button>
              <button
                disabled={isLoggingIn}
                onClick={() => setAuthMode('register')}
                className={`flex-1 py-2 rounded-lg transition cursor-pointer ${
                  authMode === 'register' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.tab_register}
              </button>
            </div>

            <div className="space-y-4">
              {authMode === 'unlock' && (
                <div className="space-y-3">
                  <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-xl flex items-center justify-between">
                    <span className="text-xs text-slate-400">已绑定账号:</span>
                    <span className="text-xs font-bold font-mono text-emerald-400">{savedAccount}</span>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">{t.label_pass}</label>
                    <input
                      type="password"
                      autoFocus
                      disabled={isLoggingIn}
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !isLoggingIn && handleUnlock()}
                      placeholder="输入主保护口令"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    disabled={isLoggingIn}
                    onClick={handleUnlock}
                    className={`w-full text-xs font-semibold py-3 rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer ${
                      isLoggingIn ? 'bg-blue-800 text-slate-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {isLoggingIn ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>正在校验并登录中...</span>
                      </>
                    ) : (
                      <span>{t.btn_unlock}</span>
                    )}
                  </button>
                </div>
              )}

              {authMode === 'import' && (
                <div className="space-y-3">
                  <div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept=".txt"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        readOnly
                        value={importFileName}
                        placeholder="未选择凭据文件 (credentials.txt)"
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 truncate"
                      />
                      <button
                        type="button"
                        disabled={isLoggingIn}
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-xl text-xs font-semibold shadow-sm transition cursor-pointer"
                      >
                        {t.btn_browse}
                      </button>
                    </div>
                  </div>
                  <div>
                    <input
                      type="password"
                      placeholder={t.label_set_pass}
                      disabled={isLoggingIn}
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    disabled={isLoggingIn}
                    onClick={handleImportSave}
                    className={`w-full text-xs font-semibold py-3 rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer ${
                      isLoggingIn ? 'bg-emerald-800 text-slate-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {isLoggingIn ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>正在加密导入并启动...</span>
                      </>
                    ) : (
                      <span>{t.btn_encrypt_save}</span>
                    )}
                  </button>
                </div>
              )}

              {authMode === 'register' && (
                <div className="space-y-3">
                  <input
                    type="text"
                    disabled={isLoggingIn}
                    placeholder="邀请码 (Invite Code)"
                    value={regInvite}
                    onChange={(e) => setRegInvite(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100"
                  />
                  <input
                    type="text"
                    disabled={isLoggingIn}
                    placeholder="新用户名 (8-30位小写英文开头)"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100"
                  />
                  <input
                    type="password"
                    disabled={isLoggingIn}
                    placeholder="设定保护密码 (至少6位)"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100"
                  />
                  <button
                    disabled={isLoggingIn}
                    onClick={handleRegister}
                    className={`w-full text-xs font-semibold py-3 rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer ${
                      isLoggingIn ? 'bg-emerald-800 text-slate-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {isLoggingIn ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>正在生成私钥并广播注册...</span>
                      </>
                    ) : (
                      <span>{t.btn_register_submit}</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* 主工作台界面 */
        <div className="flex flex-1 overflow-hidden">
          {/* 侧边栏 */}
          <aside className="w-52 bg-[#111827] border-r border-slate-800 p-3 flex flex-col justify-between">
            <nav className="space-y-1">
              {[
                { id: 'gateway', label: t.nav_gateway, icon: '🛡️' },
                { id: 'otp', label: t.nav_otp, icon: '⚡' },
                { id: 'rules', label: t.nav_rules, icon: '⚙️' },
                { id: 'logs', label: t.nav_logs, icon: '📋' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                    activeTab === tab.id ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>

            <div className="space-y-2">
              <button
                onClick={handleExportCurrentCredentials}
                className="w-full flex items-center justify-center space-x-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 rounded-xl text-xs text-slate-300 transition cursor-pointer"
              >
                <span>📥</span>
                <span>导出密钥备份</span>
              </button>

              <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 text-[11px] text-slate-500">
                <div className="flex justify-between">
                  <span>{t.core_engine}</span>
                  <span className={isGwRunning ? 'text-emerald-400 font-bold' : 'text-rose-400'}>
                    {isGwRunning ? 'Online' : 'Stopped'}
                  </span>
                </div>
                <div className="truncate">Acc: {currentAccount}</div>
              </div>
            </div>
          </aside>

          {/* 内容面板 */}
          <main className="flex-1 p-6 overflow-y-auto bg-[#0b0f19]">
            {/* 1. 网关守护 */}
            {activeTab === 'gateway' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold">{t.gw_title}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{t.gw_desc}</p>
                </div>

                <div className="bg-[#151d30] border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
                  <div className="flex items-center space-x-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold ${
                      isGwRunning ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                    }`}>
                      {isGwRunning ? '▶' : '⏹'}
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-slate-400 uppercase">{t.gw_status_label}</div>
                      <div className={`text-lg font-bold ${isGwRunning ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isGwRunning ? t.gw_running : t.gw_stopped}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={toggleGateway}
                    className={`text-xs font-semibold px-6 py-3 rounded-xl shadow-lg transition cursor-pointer ${
                      isGwRunning ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                    }`}
                  >
                    {isGwRunning ? t.gw_btn_stop : t.gw_btn_start}
                  </button>
                </div>
              </div>
            )}

            {/* 2. OTP */}
            {activeTab === 'otp' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold">{t.otp_title}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{t.otp_desc}</p>
                </div>

                <div className="bg-[#151d30] border border-slate-800 rounded-2xl p-6 max-w-sm mx-auto flex flex-col items-center space-y-4 shadow-xl">
                  <div className="text-xs text-slate-400 font-medium flex items-center space-x-1.5">
                    <span>{t.otp_label}</span>
                    {otpTimer !== null && <span className="text-[10px] text-blue-400 font-mono">({otpTimer}s)</span>}
                  </div>

                  <div className="w-full flex items-center justify-between bg-slate-900 border border-slate-700 rounded-xl px-5 py-3">
                    <div className="font-mono text-2xl font-bold tracking-[0.2em] text-amber-400">{otpCode}</div>
                    <button
                      onClick={handleCopyOtp}
                      className="text-xs px-2.5 py-1.5 bg-slate-800 rounded-lg border border-slate-700 hover:bg-slate-700 text-slate-200 transition cursor-pointer"
                    >
                      复制
                    </button>
                  </div>

                  <button
                    onClick={fetchOtp}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2.5 rounded-xl shadow-md transition cursor-pointer"
                  >
                    {t.otp_refresh_btn}
                  </button>
                </div>
              </div>
            )}

            {/* 3. 风控配置 */}
            {activeTab === 'rules' && rules && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold flex items-center space-x-2">
                      <span>{t.rules_title}</span>
                      <span className="text-xs font-normal text-emerald-400 font-mono">({currentAccount})</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">{t.rules_desc}</p>
                  </div>
                  <div className="flex space-x-2">
                    <input
                      type="file"
                      ref={rulesFileInputRef}
                      accept=".json"
                      onChange={handleImportRulesJson}
                      className="hidden"
                    />
                    <button
                      onClick={() => rulesFileInputRef.current?.click()}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-xl border border-slate-700 transition cursor-pointer"
                    >
                      📂 导入 JSON
                    </button>
                    <button
                      onClick={exportRulesJson}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-xl border border-slate-700 transition cursor-pointer"
                    >
                      💾 导出 JSON
                    </button>
                    <button
                      onClick={saveRulesToLocal}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-1.5 rounded-xl shadow-md transition cursor-pointer"
                    >
                      {t.btn_save_rules}
                    </button>
                  </div>
                </div>

                <div className="flex border-b border-slate-800 space-x-6 text-xs text-slate-400">
                  {(['devices', 'unlimited', 'micro', 'trading'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setRulesSubTab(st)}
                      className={`pb-2 transition cursor-pointer ${rulesSubTab === st ? 'border-b-2 border-blue-500 text-blue-400 font-bold' : 'hover:text-slate-200'}`}
                    >
                      {t[`rules_tab_${st}` as keyof typeof t]}
                    </button>
                  ))}
                </div>

                {/* 子面板 1: 全局与设备管理 */}
                {rulesSubTab === 'devices' && (
                  <div className="space-y-4">
                    <div className="bg-[#151d30] border border-blue-500/30 p-3.5 rounded-xl flex items-center justify-between shadow-lg">
                      <div>
                        <div className="text-xs font-bold text-slate-200">{t.global_fee_title}</div>
                        <div className="text-[11px] text-slate-400">{t.global_fee_desc}</div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="number"
                          value={rules.fee_limit}
                          onChange={(e) => setRules({ ...rules, fee_limit: parseFloat(e.target.value) || 0 })}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-xs w-28 text-emerald-400 font-mono focus:outline-none focus:border-blue-500"
                        />
                        <span className="text-xs font-semibold text-slate-400">BTS</span>
                      </div>
                    </div>

                    <div className="bg-[#151d30] border border-slate-800 p-4 rounded-xl space-y-3 shadow-xl">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-xs text-slate-200">{t.devices_table_title}</span>
                        <button
                          onClick={() => {
                            const fp = prompt('请输入设备公钥指纹 (SHA-256 前50位):');
                            if (!fp) return;
                            const alias = prompt('请输入设备别名 (Alias, 如 phone-wallet):');
                            if (!alias) return;
                            setRules({
                              ...rules,
                              public_keys: { ...rules.public_keys, [fp.trim()]: alias.trim() },
                            });
                          }}
                          className="bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 px-3 py-1 rounded-lg text-xs cursor-pointer"
                        >
                          + {t.btn_add_device}
                        </button>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-400 border-b border-slate-800">
                            <th className="py-1 px-2 text-left">{t.th_fingerprint}</th>
                            <th className="py-1 px-2 text-left">{t.th_alias}</th>
                            <th className="py-1 px-2 text-center">{t.th_oauth}</th>
                            <th className="py-1 px-2 text-right">{t.th_actions}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(rules.public_keys).map(([fp, alias]) => (
                            <tr key={fp} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                              <td className="py-1.5 px-2 font-mono text-[11px] text-slate-300">{fp}</td>
                              <td className="py-1.5 px-2 font-semibold text-slate-200">{alias}</td>
                              <td className="py-1.5 px-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={rules.oauth_allowed_devices.includes(alias)}
                                  onChange={(e) => {
                                    const newOauth = e.target.checked
                                      ? [...rules.oauth_allowed_devices, alias]
                                      : rules.oauth_allowed_devices.filter((a) => a !== alias);
                                    setRules({ ...rules, oauth_allowed_devices: newOauth });
                                  }}
                                />
                              </td>
                              <td className="py-1.5 px-2 text-right">
                                <button
                                  onClick={() => {
                                    const copy = { ...rules.public_keys };
                                    delete copy[fp];
                                    setRules({
                                      ...rules,
                                      public_keys: copy,
                                      oauth_allowed_devices: rules.oauth_allowed_devices.filter((a) => a !== alias),
                                    });
                                  }}
                                  className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                                >
                                  ✕ 删除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 子面板 2: 自由大额转账 */}
                {rulesSubTab === 'unlimited' && (
                  <div className="space-y-4 text-xs">
                    <div className="bg-[#151d30] border border-slate-800 p-4 rounded-xl space-y-3 shadow-xl">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-200">{t.unlimited_devices_title}</span>
                        <div className="flex items-center space-x-2">
                          <select
                            id="unlimitedDevSelect"
                            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200"
                          >
                            {getKnownAliases().map((a) => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const sel = (document.getElementById('unlimitedDevSelect') as HTMLSelectElement)?.value;
                              if (!sel) return;
                              if (!rules.unlimited_payments.authorized_devices.includes(sel)) {
                                setRules({
                                  ...rules,
                                  unlimited_payments: {
                                    ...rules.unlimited_payments,
                                    authorized_devices: [...rules.unlimited_payments.authorized_devices, sel],
                                  },
                                });
                              }
                            }}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg cursor-pointer"
                          >
                            {t.btn_add}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {rules.unlimited_payments.authorized_devices.map((d) => (
                          <span key={d} className="bg-blue-900/40 text-blue-300 border border-blue-700/60 px-2.5 py-1 rounded-lg flex items-center space-x-2">
                            <span>{d}</span>
                            <button
                              onClick={() => {
                                setRules({
                                  ...rules,
                                  unlimited_payments: {
                                    ...rules.unlimited_payments,
                                    authorized_devices: rules.unlimited_payments.authorized_devices.filter((x) => x !== d),
                                  },
                                });
                              }}
                              className="text-rose-400 font-bold cursor-pointer"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-[#151d30] border border-slate-800 p-4 rounded-xl space-y-3 shadow-xl">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="font-semibold text-slate-200">{t.unlimited_recipients_title}</span>
                          <p className="text-[11px] text-slate-400 mt-0.5">支持为交易所等指定必填 Memo 附言；留空则表示允许任意附言。</p>
                        </div>
                        <button
                          onClick={() => {
                            const acc = prompt('请输入收款人用户名 (如 bts-binance):');
                            if (!acc) return;
                            const id = prompt('请输入对应的 BitShares 账号 ID (如 1.2.31073):');
                            if (!id) return;
                            const memo = prompt('可选限定 Memo (留空表示不限制附言):') || '';
                            setRules({
                              ...rules,
                              unlimited_payments: {
                                ...rules.unlimited_payments,
                                recipient_whitelist: {
                                  ...(rules.unlimited_payments.recipient_whitelist || {}),
                                  [acc]: memo ? { id, required_memo: memo } : id,
                                },
                              },
                            });
                          }}
                          className="bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 px-3 py-1 rounded-lg text-xs cursor-pointer"
                        >
                          + {t.btn_add_recipient}
                        </button>
                      </div>
                      <div className="space-y-2">
                        {Object.entries(rules.unlimited_payments.recipient_whitelist || {}).map(([acc, rule]) => {
                          const idStr = typeof rule === 'object' ? rule.id : rule;
                          const memoStr = typeof rule === 'object' ? (rule.required_memo || '') : '';
                          return (
                            <div key={acc} className="flex items-center space-x-2 bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                              <span className="text-slate-400">账户:</span>
                              <span className="font-bold text-slate-200 w-28 truncate">{acc}</span>

                              <span className="text-slate-400">ID:</span>
                              <input
                                type="text"
                                value={idStr}
                                onChange={(e) => {
                                  const newId = e.target.value.trim();
                                  setRules({
                                    ...rules,
                                    unlimited_payments: {
                                      ...rules.unlimited_payments,
                                      recipient_whitelist: {
                                        ...rules.unlimited_payments,
                                        [acc]: memoStr ? { id: newId, required_memo: memoStr } : newId,
                                      },
                                    },
                                  });
                                }}
                                className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-emerald-400 font-mono w-24 focus:outline-none"
                              />

                              <span className="text-slate-400">限定附言 (Memo):</span>
                              <input
                                type="text"
                                value={memoStr}
                                placeholder="无 (允许任意附言)"
                                onChange={(e) => {
                                  const newMemo = e.target.value;
                                  setRules({
                                    ...rules,
                                    unlimited_payments: {
                                      ...rules.unlimited_payments,
                                      recipient_whitelist: {
                                        ...rules.unlimited_payments,
                                        [acc]: newMemo ? { id: idStr, required_memo: newMemo } : idStr,
                                      },
                                    },
                                  });
                                }}
                                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-amber-400 font-mono text-xs focus:outline-none"
                              />

                              <button
                                onClick={() => {
                                  const copy = { ...rules.unlimited_payments.recipient_whitelist };
                                  delete copy[acc];
                                  setRules({
                                    ...rules,
                                    unlimited_payments: { ...rules.unlimited_payments, recipient_whitelist: copy },
                                  });
                                }}
                                className="text-rose-400 hover:text-rose-300 font-semibold px-2 cursor-pointer"
                              >
                                ✕ 删除
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 子面板 3: 小额微支付 */}
                {rulesSubTab === 'micro' && (
                  <div className="space-y-4 text-xs">
                    <div className="bg-[#151d30] border border-slate-800 p-4 rounded-xl space-y-3 shadow-xl">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-200">{t.micro_base_title}</span>
                        <button
                          onClick={() => {
                            const coin = prompt('请输入资产代码 (如 CNY, BTS, USD):');
                            if (!coin) return;
                            const val = parseFloat(prompt('请输入单笔基准额度:') || '100');
                            setRules({
                              ...rules,
                              micro_payments: {
                                ...rules.micro_payments,
                                base_limits: { ...rules.micro_payments.base_limits, [coin.toUpperCase().trim()]: val },
                              },
                            });
                          }}
                          className="bg-blue-600/20 text-blue-400 border border-blue-500/30 px-3 py-1 rounded-lg text-xs cursor-pointer"
                        >
                          + {t.btn_add_coin}
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {Object.entries(rules.micro_payments.base_limits).map(([coin, limit]) => (
                          <div key={coin} className="flex items-center justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800">
                            <span className="font-bold text-slate-300">{coin}</span>
                            <input
                              type="number"
                              value={limit}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setRules({
                                  ...rules,
                                  micro_payments: {
                                    ...rules.micro_payments,
                                    base_limits: { ...rules.micro_payments.base_limits, [coin]: val },
                                  },
                                });
                              }}
                              className="bg-transparent text-right text-emerald-400 font-mono w-20 focus:outline-none"
                            />
                            <button
                              onClick={() => {
                                const copy = { ...rules.micro_payments.base_limits };
                                delete copy[coin];
                                setRules({
                                  ...rules,
                                  micro_payments: { ...rules.micro_payments, base_limits: copy },
                                });
                              }}
                              className="text-rose-400 font-bold px-1 cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-[#151d30] border border-slate-800 p-4 rounded-xl space-y-3 shadow-xl">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-200">{t.micro_dev_rules_title}</span>
                        <div className="flex items-center space-x-2">
                          <select
                            id="microDevSelect"
                            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200"
                          >
                            {getKnownAliases().map((a) => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const dev = (document.getElementById('microDevSelect') as HTMLSelectElement)?.value;
                              if (!dev) return;
                              if (rules.micro_payments.device_rules[dev]) {
                                return alert(`设备 [${dev}] 已经存在风控规则！`);
                              }
                              setRules({
                                ...rules,
                                micro_payments: {
                                  ...rules.micro_payments,
                                  device_rules: {
                                    ...rules.micro_payments,
                                    [dev]: {
                                      single_multiplier: 2,
                                      day_max_multiplier: 10,
                                      week_max_multiplier: 50,
                                      pin: '',
                                    },
                                  },
                                },
                              });
                            }}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg cursor-pointer"
                          >
                            + 添加设备规则
                          </button>
                        </div>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-slate-400 border-b border-slate-800">
                            <th className="py-1 px-2 text-left">{t.th_device}</th>
                            <th className="py-1 px-2">{t.th_single_mult}</th>
                            <th className="py-1 px-2">{t.th_day_mult}</th>
                            <th className="py-1 px-2">{t.th_week_mult}</th>
                            <th className="py-1 px-2">{t.th_pin}</th>
                            <th className="py-1 px-2 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(rules.micro_payments.device_rules).map(([dev, devRule]) => (
                            <tr key={dev} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                              <td className="py-1.5 px-2 font-semibold text-slate-200">{dev}</td>
                              <td className="py-1.5 px-2 text-center">
                                <input
                                  type="number"
                                  step="0.1"
                                  value={devRule.single_multiplier}
                                  onChange={(e) => {
                                    setRules({
                                      ...rules,
                                      micro_payments: {
                                        ...rules.micro_payments,
                                        device_rules: {
                                          ...rules.micro_payments,
                                          [dev]: { ...devRule, single_multiplier: parseFloat(e.target.value) || 1 },
                                        },
                                      },
                                    });
                                  }}
                                  className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 w-16 text-emerald-400 text-center"
                                />
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <input
                                  type="number"
                                  step="1"
                                  value={devRule.day_max_multiplier}
                                  onChange={(e) => {
                                    setRules({
                                      ...rules,
                                      micro_payments: {
                                        ...rules.micro_payments,
                                        device_rules: {
                                          ...rules.micro_payments,
                                          [dev]: { ...devRule, day_max_multiplier: parseFloat(e.target.value) || 1 },
                                        },
                                      },
                                    });
                                  }}
                                  className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 w-16 text-emerald-400 text-center"
                                />
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <input
                                  type="number"
                                  step="1"
                                  value={devRule.week_max_multiplier}
                                  onChange={(e) => {
                                    setRules({
                                      ...rules,
                                      micro_payments: {
                                        ...rules.micro_payments,
                                        device_rules: {
                                          ...rules.micro_payments,
                                          [dev]: { ...devRule, week_max_multiplier: parseFloat(e.target.value) || 1 },
                                        },
                                      },
                                    });
                                  }}
                                  className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 w-16 text-emerald-400 text-center"
                                />
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <input
                                  type="text"
                                  value={devRule.pin !== undefined ? String(devRule.pin) : ''}
                                  placeholder="无"
                                  onChange={(e) => {
                                    setRules({
                                      ...rules,
                                      micro_payments: {
                                        ...rules.micro_payments,
                                        device_rules: {
                                          ...rules.micro_payments,
                                          [dev]: { ...devRule, pin: e.target.value },
                                        },
                                      },
                                    });
                                  }}
                                  className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 w-20 text-amber-400 font-mono text-center"
                                />
                              </td>
                              <td className="py-1.5 px-2 text-right">
                                <button
                                  onClick={() => {
                                    const copy = { ...rules.micro_payments.device_rules };
                                    delete copy[dev];
                                    setRules({
                                      ...rules,
                                      micro_payments: {
                                        ...rules.micro_payments,
                                        device_rules: copy,
                                      },
                                    });
                                  }}
                                  className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                                >
                                  ✕ 删除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 子面板 4: 交易与挂单风控 */}
                {rulesSubTab === 'trading' && (
                  <div className="space-y-4 text-xs">
                    <div className="bg-[#151d30] border border-slate-800 p-4 rounded-xl space-y-3 shadow-xl">
                      <span className="font-semibold text-slate-200">{t.volatility_title}</span>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-slate-400 mb-1">1小时偏离度 (1h Limit)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={rules.trading_risk.volatility_limit_1h}
                            onChange={(e) =>
                              setRules({
                                ...rules,
                                trading_risk: { ...rules.trading_risk, volatility_limit_1h: parseFloat(e.target.value) || 0.97 },
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-emerald-400 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-400 mb-1">1天偏离度 (1d Limit)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={rules.trading_risk.volatility_limit_1d}
                            onChange={(e) =>
                              setRules({
                                ...rules,
                                trading_risk: { ...rules.trading_risk, volatility_limit_1d: parseFloat(e.target.value) || 0.95 },
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-emerald-400 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-400 mb-1">1周偏离度 (1w Limit)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={rules.trading_risk.volatility_limit_1w}
                            onChange={(e) =>
                              setRules({
                                ...rules,
                                trading_risk: { ...rules.trading_risk, volatility_limit_1w: parseFloat(e.target.value) || 0.90 },
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-emerald-400 font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#151d30] border border-slate-800 p-4 rounded-xl space-y-3 shadow-xl">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-200">{t.market_whitelist_title}</span>
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            placeholder="例如: CNY/BTS"
                            value={newMarket}
                            onChange={(e) => setNewMarket(e.target.value.toUpperCase())}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-xs text-slate-200 uppercase w-28"
                          />
                          <button
                            onClick={() => {
                              if (!newMarket) return;
                              if (!rules.trading_risk.market_whitelist.includes(newMarket)) {
                                setRules({
                                  ...rules,
                                  trading_risk: {
                                    ...rules.trading_risk,
                                    market_whitelist: [...rules.trading_risk.market_whitelist, newMarket],
                                  },
                                });
                                setNewMarket('');
                              }
                            }}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded-lg cursor-pointer"
                          >
                            {t.btn_add}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {rules.trading_risk.market_whitelist.map((m) => (
                          <span key={m} className="bg-slate-800 text-slate-200 border border-slate-700 px-2.5 py-1 rounded-lg flex items-center space-x-2 font-mono">
                            <span>{m}</span>
                            <button
                              onClick={() => {
                                setRules({
                                  ...rules,
                                  trading_risk: {
                                    ...rules.trading_risk,
                                    market_whitelist: rules.trading_risk.market_whitelist.filter((x) => x !== m),
                                  },
                                });
                              }}
                              className="text-rose-400 font-bold cursor-pointer"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 4. 实时日志 */}
            {activeTab === 'logs' && (
              <div className="space-y-3 flex flex-col h-full">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold">{t.logs_title}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">点击未授权日志可直接复制指纹；新日志自动滚动至底部</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <label className="flex items-center space-x-1 text-xs text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoScrollLogs}
                        onChange={(e) => setAutoScrollLogs(e.target.checked)}
                        className="rounded border-slate-700"
                      />
                      <span>自动滚屏</span>
                    </label>
                    <button
                      onClick={() => {
                        if (logs.length === 0) return alert('当前没有日志可导出');
                        const logFilename = `btsbots_logs_${currentAccount || 'default'}_${Date.now()}.txt`;
                        downloadFile(logFilename, logs.join('\n'));
                        alert(`✓ 运行日志已成功导出至文件: ${logFilename}`);
                      }}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-1 rounded-lg border border-slate-700 cursor-pointer"
                    >
                      📥 导出日志
                    </button>
                    <button
                      onClick={() => {
                        signBotsEngine.clearLogs();
                        setLogs([]);
                      }}
                      className="bg-slate-800 hover:bg-slate-700 text-xs px-2.5 py-1 rounded-lg border border-slate-700 cursor-pointer"
                    >
                      {t.btn_clear_logs}
                    </button>
                  </div>
                </div>
                <div className="flex-1 bg-[#070b13] border border-slate-800 rounded-xl p-3.5 font-mono text-xs text-emerald-400 overflow-y-auto select-text cursor-text">
                  {logs.map((log, index) => (
                    <div
                      key={index}
                      onClick={() => handleLogClick(log)}
                      className="py-0.5 leading-relaxed hover:bg-slate-800/40 rounded px-1 transition cursor-pointer select-text"
                      title="点击智能复制指纹或日志内容"
                    >
                      {log}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}