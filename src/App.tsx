import React, { useState, useEffect, useRef } from 'react';
import { i18n } from './i18n/locales';
import { KeystoreManager } from './core/keystore';
import { signBotsEngine } from './core/signBots';
import { copyToClipboard } from './core/utils';
import { SecurityRules } from './types/rules';

export function App() {
  const [lang, setLang] = useState<'zh' | 'en' | 'ru'>('zh');
  const [activeTab, setActiveTab] = useState<'auth' | 'gateway' | 'otp' | 'rules' | 'logs'>('auth');
  const [rulesSubTab, setRulesSubTab] = useState<'devices' | 'unlimited' | 'micro' | 'trading'>('devices');

  const [hasKeystore, setHasKeystore] = useState(false);
  const [savedAccount, setSavedAccount] = useState<string | null>(null);
  const [currentAccount, setCurrentAccount] = useState<string | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isGwRunning, setIsGwRunning] = useState(false);

  // Forms
  const [unlockPassword, setUnlockPassword] = useState('');
  const [importFileContent, setImportFileContent] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [regInvite, setRegInvite] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // OTP
  const [otpCode, setOtpCode] = useState('--------');
  const [otpTimer, setOtpTimer] = useState<number | null>(null);

  // Rules State
  const [rules, setRules] = useState<SecurityRules | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Rules Sub Forms Temp State
  const [newMarket, setNewMarket] = useState('');

  const t = i18n[lang];

  useEffect(() => {
    (window as any).__onBtsLog = (msg: string) => {
      setLogs((prev) => [...prev.slice(-200), msg]);
    };

    const ksExists = KeystoreManager.exists();
    const saved = KeystoreManager.getSavedAccountName();
    setHasKeystore(ksExists);
    setSavedAccount(saved);

    signBotsEngine.loadRules().then((r) => setRules(r));
  }, []);

  useEffect(() => {
    if (otpTimer && otpTimer > 0) {
      const timer = setTimeout(() => setOtpTimer(otpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [otpTimer]);

  const handleUnlock = async () => {
    if (!unlockPassword) return alert('请输入解锁口令！');
    try {
      const creds = await KeystoreManager.loadCredentials(unlockPassword);
      setCurrentAccount(creds.account);
      setIsUnlocked(true);
      await signBotsEngine.loginWithKeys(creds.account, creds.keys);
      setUnlockPassword('');
      alert(`🎉 [${creds.account}] 解锁成功！`);
      setActiveTab('gateway');
    } catch (e: any) {
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

    try {
      await KeystoreManager.saveCredentials(importPassword, account, keys);
      setHasKeystore(true);
      setSavedAccount(account);
      setCurrentAccount(account);
      setIsUnlocked(true);
      await signBotsEngine.loginWithKeys(account, keys);

      setImportPassword('');
      setImportFileContent('');
      setImportFileName('');

      alert(`🎉 凭据导入成功！已加密保存。当前账号: ${account}`);
      setActiveTab('gateway');
    } catch (err: any) {
      alert(`导入失败: ${err.message}`);
    }
  };

  const handleRegister = async () => {
    if (!regInvite || !regUsername || !regPassword) {
      return alert('请完整填写邀请码、新用户名和保护密码！');
    }
    try {
      const res = await signBotsEngine.registerAccount(regInvite, regUsername);
      await KeystoreManager.saveCredentials(regPassword, res.username, res.keys);
      setHasKeystore(true);
      setSavedAccount(res.username);
      setCurrentAccount(res.username);
      setIsUnlocked(true);
      await signBotsEngine.loginWithKeys(res.username, res.keys);

      setRegPassword('');
      setRegInvite('');
      setRegUsername('');

      alert(`✨ 账号 [${res.username}] 注册申请已提交！私钥已加密至金库。`);
      setActiveTab('gateway');
    } catch (e: any) {
      alert(`注册失败: ${e.message}`);
    }
  };

  const toggleGateway = async () => {
    if (!isUnlocked) return alert('请先解锁账号！');
    if (!isGwRunning) {
      try {
        await signBotsEngine.startGateway();
        setIsGwRunning(true);
        setActiveTab('logs');
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
    if (!rules) return;
    await signBotsEngine.saveRules(rules);
    alert('✓ 风控策略已保存至本地 Storage 并即时生效！');
  };

  const exportRulesJson = () => {
    if (!rules) return;
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'security_rules.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getKnownAliases = () => {
    return Object.values(rules?.public_keys || {});
  };

  return (
    <div className="flex flex-col h-screen select-none bg-[#0b0f19] text-slate-100">
      {/* 顶部导航 */}
      <header className="bg-[#111827] border-b border-slate-800/80 px-6 py-2.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-600 text-white p-2 rounded-xl shadow-md">
            🛡️
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide flex items-center space-x-2">
              <span>{t.app_title}</span>
              <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30">
                Zero-Trust TS Edition
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">{t.app_subtitle}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800">
            <div className={`w-2.5 h-2.5 rounded-full ${isGwRunning ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 leading-tight">{t.engine_indicator}</span>
              <span className={`text-[11px] font-bold leading-tight ${isGwRunning ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isGwRunning ? t.engine_online : t.engine_offline}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800">
            <div className={`w-2 h-2 rounded-full ${isUnlocked ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            <span className={`text-xs font-semibold ${isUnlocked ? 'text-emerald-400' : 'text-slate-300'}`}>
              {currentAccount || savedAccount || t.wallet_locked}
            </span>
          </div>

          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as any)}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none"
          >
            <option value="zh">🇨🇳 简体中文</option>
            <option value="en">🇺🇸 English</option>
            <option value="ru">🇷🇺 Русский</option>
          </select>
        </div>
      </header>

      {/* 工作区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 侧边栏 */}
        <aside className="w-52 bg-[#111827] border-r border-slate-800/80 p-3 flex flex-col justify-between">
          <nav className="space-y-1">
            {[
              { id: 'auth', label: t.nav_vault, icon: '🔑' },
              { id: 'gateway', label: t.nav_gateway, icon: '🛡️' },
              { id: 'otp', label: t.nav_otp, icon: '⚡' },
              { id: 'rules', label: t.nav_rules, icon: '⚙️' },
              { id: 'logs', label: t.nav_logs, icon: '📋' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition ${
                  activeTab === tab.id ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 text-[11px] text-slate-500">
            <div className="flex justify-between">
              <span>{t.core_engine}</span>
              <span className={isGwRunning ? 'text-emerald-400' : 'text-rose-400'}>
                {isGwRunning ? 'Online' : 'Stopped'}
              </span>
            </div>
            <div>BTSBots TS Engine</div>
          </div>
        </aside>

        {/* 内容卡片 */}
        <main className="flex-1 p-6 overflow-y-auto bg-[#0b0f19]">
          {/* 1. 账号管理 */}
          {activeTab === 'auth' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">{t.vault_title}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{t.vault_desc}</p>
              </div>

              {hasKeystore && (
                <div className="bg-[#151d30]/70 backdrop-blur border border-blue-500/20 rounded-2xl p-6 max-w-lg space-y-4 shadow-xl">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
                        🔑
                      </div>
                      <div>
                        <h3 className="font-bold text-sm">{t.vault_unlock_title}</h3>
                        <p className="text-xs text-slate-400 font-mono">已绑定账号: [{savedAccount}]</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">{t.label_pass}</label>
                    <input
                      type="password"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                      placeholder="输入主保护口令"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <button
                    onClick={handleUnlock}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-6 py-2.5 rounded-xl shadow-md transition"
                  >
                    {t.btn_unlock}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 max-w-3xl pt-2">
                {/* 导入 */}
                <div className="bg-[#151d30]/70 border border-white/5 rounded-2xl p-5 space-y-3 shadow-xl">
                  <h4 className="font-bold text-xs">{t.vault_import_title}</h4>
                  
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
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 truncate"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shadow-sm transition"
                      >
                        {t.btn_browse}
                      </button>
                    </div>
                  </div>

                  <div>
                    <input
                      type="password"
                      placeholder={t.label_set_pass}
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    onClick={handleImportSave}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 rounded-xl transition border border-slate-700"
                  >
                    {t.btn_encrypt_save}
                  </button>
                </div>

                {/* 注册 */}
                <div className="bg-[#151d30]/70 border border-white/5 rounded-2xl p-5 space-y-3 shadow-xl">
                  <h4 className="font-bold text-xs">{t.vault_reg_title}</h4>
                  <input
                    type="text"
                    placeholder="邀请码 (Invite Code)"
                    value={regInvite}
                    onChange={(e) => setRegInvite(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <input
                    type="text"
                    placeholder="新用户名 (8-30位小写英文开头)"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <input
                    type="password"
                    placeholder="设定保护密码 (至少6位)"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <button
                    onClick={handleRegister}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 rounded-xl transition shadow-md shadow-emerald-600/20"
                  >
                    {t.btn_register_submit}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. 网关守护 */}
          {activeTab === 'gateway' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">{t.gw_title}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{t.gw_desc}</p>
              </div>

              <div className="bg-[#151d30]/70 border border-white/5 rounded-2xl p-5 flex items-center justify-between shadow-xl">
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
                  className={`text-xs font-semibold px-5 py-2.5 rounded-xl shadow-lg transition ${
                    isGwRunning ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                  }`}
                >
                  {isGwRunning ? t.gw_btn_stop : t.gw_btn_start}
                </button>
              </div>
            </div>
          )}

          {/* 3. OTP */}
          {activeTab === 'otp' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold">{t.otp_title}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{t.otp_desc}</p>
              </div>

              <div className="bg-[#151d30]/70 border border-white/5 rounded-2xl p-6 max-w-sm mx-auto flex flex-col items-center space-y-4 shadow-xl">
                <div className="text-xs text-slate-400 font-medium flex items-center space-x-1.5">
                  <span>{t.otp_label}</span>
                  {otpTimer !== null && <span className="text-[10px] text-blue-400 font-mono">({otpTimer}s)</span>}
                </div>

                <div className="w-full flex items-center justify-between bg-slate-900 border border-slate-700/80 rounded-xl px-5 py-3">
                  <div className="font-mono text-2xl font-bold tracking-[0.2em] text-amber-400">{otpCode}</div>
                  <button
                    onClick={handleCopyOtp}
                    className="text-xs px-2.5 py-1.5 bg-slate-800 rounded-lg border border-slate-700 hover:bg-slate-700 text-slate-200 transition"
                  >
                    复制
                  </button>
                </div>

                <button
                  onClick={fetchOtp}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2.5 rounded-xl shadow-md transition"
                >
                  {t.otp_refresh_btn}
                </button>
              </div>
            </div>
          )}

          {/* 4. 风控配置全量子面板 */}
          {activeTab === 'rules' && rules && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold">{t.rules_title}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{t.rules_desc}</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={exportRulesJson}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-xl border border-slate-700 transition"
                  >
                    导出 JSON
                  </button>
                  <button
                    onClick={saveRulesToLocal}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-1.5 rounded-xl shadow-md transition"
                  >
                    {t.btn_save_rules}
                  </button>
                </div>
              </div>

              {/* 子选项卡 */}
              <div className="flex border-b border-slate-800 space-x-6 text-xs text-slate-400">
                {(['devices', 'unlimited', 'micro', 'trading'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setRulesSubTab(st)}
                    className={`pb-2 transition ${rulesSubTab === st ? 'border-b-2 border-blue-500 text-blue-400 font-bold' : 'hover:text-slate-200'}`}
                  >
                    {t[`rules_tab_${st}` as keyof typeof t]}
                  </button>
                ))}
              </div>

              {/* 子面板 1: 全局与设备管理 (合并手续费上限) */}
              {rulesSubTab === 'devices' && (
                <div className="space-y-4">
                  <div className="bg-[#151d30]/70 border border-blue-500/30 p-3.5 rounded-xl flex items-center justify-between shadow-lg">
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

                  <div className="bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl">
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
                        className="bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 px-3 py-1 rounded-lg text-xs"
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
                                className="text-rose-400 hover:text-rose-300 font-semibold"
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
                  <div className="bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl">
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
                          className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg"
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
                            className="text-rose-400 font-bold"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl">
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
                                ...rules.unlimited_payments.recipient_whitelist,
                                [acc]: memo ? { id, required_memo: memo } : { id, required_memo: '' },
                              },
                            },
                          });
                        }}
                        className="bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 px-3 py-1 rounded-lg text-xs"
                      >
                        + {t.btn_add_recipient}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {Object.entries(rules.unlimited_payments.recipient_whitelist).map(([acc, rule]) => {
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
                                      [acc]: { id: newId, required_memo: memoStr },
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
                                      [acc]: { id: idStr, required_memo: newMemo },
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
                              className="text-rose-400 hover:text-rose-300 font-semibold px-2"
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
                  <div className="bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl">
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
                        className="bg-blue-600/20 text-blue-400 border border-blue-500/30 px-3 py-1 rounded-lg text-xs"
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
                            className="text-rose-400 font-bold px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl">
                    <span className="font-semibold text-slate-200">{t.micro_dev_rules_title}</span>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-800">
                          <th className="py-1 px-2 text-left">{t.th_device}</th>
                          <th className="py-1 px-2">{t.th_single_mult}</th>
                          <th className="py-1 px-2">{t.th_day_mult}</th>
                          <th className="py-1 px-2">{t.th_week_mult}</th>
                          <th className="py-1 px-2">{t.th_pin}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(rules.micro_payments.device_rules).map(([dev, devRule]) => (
                          <tr key={dev} className="border-b border-slate-800/40">
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
                  <div className="bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl">
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

                  <div className="bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl">
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
                          className="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded-lg"
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
                            className="text-rose-400 font-bold"
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

          {/* 5. 实时日志 */}
          {activeTab === 'logs' && (
            <div className="space-y-3 flex flex-col h-full">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold">{t.logs_title}</h2>
                <button
                  onClick={() => setLogs([])}
                  className="bg-slate-800 hover:bg-slate-700 text-xs px-2.5 py-1 rounded-lg border border-slate-700"
                >
                  {t.btn_clear_logs}
                </button>
              </div>
              <div className="flex-1 bg-[#070b13] border border-slate-800/80 rounded-xl p-3.5 font-mono text-xs text-emerald-400 overflow-y-auto">
                {logs.map((log, index) => (
                  <div key={index} className="py-0.5 leading-relaxed">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}