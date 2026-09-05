import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { i18n } from './i18n/locales';
import { KeystoreManager } from './core/keystore';
import { signBotsEngine } from './core/signBots';
import { copyToClipboard } from './core/utils';
export function App() {
    const [lang, setLang] = useState('zh');
    const [activeTab, setActiveTab] = useState('auth');
    const [rulesSubTab, setRulesSubTab] = useState('devices');
    const [hasKeystore, setHasKeystore] = useState(false);
    const [savedAccount, setSavedAccount] = useState(null);
    const [currentAccount, setCurrentAccount] = useState(null);
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [isGwRunning, setIsGwRunning] = useState(false);
    // Forms
    const [unlockPassword, setUnlockPassword] = useState('');
    const [importFileContent, setImportFileContent] = useState('');
    const [importFileName, setImportFileName] = useState('');
    const [importPassword, setImportPassword] = useState('');
    const fileInputRef = useRef(null);
    const [regInvite, setRegInvite] = useState('');
    const [regUsername, setRegUsername] = useState('');
    const [regPassword, setRegPassword] = useState('');
    // OTP
    const [otpCode, setOtpCode] = useState('--------');
    const [otpTimer, setOtpTimer] = useState(null);
    // Rules State
    const [rules, setRules] = useState(null);
    const [logs, setLogs] = useState([]);
    // Rules Sub Forms Temp State
    const [newMarket, setNewMarket] = useState('');
    const t = i18n[lang];
    useEffect(() => {
        window.__onBtsLog = (msg) => {
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
        if (!unlockPassword)
            return alert('请输入解锁口令！');
        try {
            const creds = await KeystoreManager.loadCredentials(unlockPassword);
            setCurrentAccount(creds.account);
            setIsUnlocked(true);
            await signBotsEngine.loginWithKeys(creds.account, creds.keys);
            setUnlockPassword('');
            alert(`🎉 [${creds.account}] 解锁成功！`);
            setActiveTab('gateway');
        }
        catch (e) {
            alert(`解锁失败: ${e.message}`);
        }
    };
    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        setImportFileName(file.name);
        const reader = new FileReader();
        reader.onload = (evt) => {
            setImportFileContent(evt.target?.result);
        };
        reader.readAsText(file);
    };
    const handleImportSave = async () => {
        if (!importFileContent || !importPassword) {
            return alert('请先选择凭据文件并输入保护口令！');
        }
        const lines = importFileContent.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length === 0)
            return alert('凭据文件为空！');
        const account = lines[0];
        const keys = [];
        for (const line of lines.slice(1)) {
            const clean = line.includes(':') ? line.split(':').pop().trim() : line.trim();
            if (clean.startsWith('5') && clean.length >= 50) {
                keys.push(clean);
            }
        }
        if (keys.length === 0)
            return alert('未从文件中识别到有效 WIF 私钥！');
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
        }
        catch (err) {
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
        }
        catch (e) {
            alert(`注册失败: ${e.message}`);
        }
    };
    const toggleGateway = async () => {
        if (!isUnlocked)
            return alert('请先解锁账号！');
        if (!isGwRunning) {
            try {
                await signBotsEngine.startGateway();
                setIsGwRunning(true);
                setActiveTab('logs');
            }
            catch (e) {
                alert(`启动失败: ${e.message}`);
            }
        }
        else {
            signBotsEngine.stopGateway();
            setIsGwRunning(false);
        }
    };
    const fetchOtp = async () => {
        if (!isUnlocked)
            return alert('请先解锁账号！');
        try {
            setOtpCode('........');
            const res = await signBotsEngine.requestOtp();
            setOtpCode(res.otp);
            setOtpTimer(res.expires);
        }
        catch (e) {
            setOtpCode('FAILED');
            alert(`获取 OTP 失败: ${e.message}`);
        }
    };
    const handleCopyOtp = async () => {
        if (!otpCode || otpCode.includes('-') || otpCode === '........')
            return;
        const ok = await copyToClipboard(otpCode);
        if (ok) {
            alert(`✓ 已复制 8 位 OTP 验证码: ${otpCode}`);
        }
        else {
            alert(`复制失败，请手动记录: ${otpCode}`);
        }
    };
    const saveRulesToLocal = async () => {
        if (!rules)
            return;
        await signBotsEngine.saveRules(rules);
        alert('✓ 风控策略已保存至本地 Storage 并即时生效！');
    };
    const exportRulesJson = () => {
        if (!rules)
            return;
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
    return (_jsxs("div", { className: "flex flex-col h-screen select-none bg-[#0b0f19] text-slate-100", children: [_jsxs("header", { className: "bg-[#111827] border-b border-slate-800/80 px-6 py-2.5 flex items-center justify-between shadow-lg", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "bg-gradient-to-tr from-blue-600 to-indigo-600 text-white p-2 rounded-xl shadow-md", children: "\uD83D\uDEE1\uFE0F" }), _jsxs("div", { children: [_jsxs("h1", { className: "text-sm font-bold tracking-wide flex items-center space-x-2", children: [_jsx("span", { children: t.app_title }), _jsx("span", { className: "text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30", children: "Zero-Trust TS Edition" })] }), _jsx("p", { className: "text-[11px] text-slate-400", children: t.app_subtitle })] })] }), _jsxs("div", { className: "flex items-center space-x-3", children: [_jsxs("div", { className: "flex items-center space-x-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800", children: [_jsx("div", { className: `w-2.5 h-2.5 rounded-full ${isGwRunning ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}` }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "text-[10px] text-slate-400 leading-tight", children: t.engine_indicator }), _jsx("span", { className: `text-[11px] font-bold leading-tight ${isGwRunning ? 'text-emerald-400' : 'text-rose-400'}`, children: isGwRunning ? t.engine_online : t.engine_offline })] })] }), _jsxs("div", { className: "flex items-center space-x-2 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800", children: [_jsx("div", { className: `w-2 h-2 rounded-full ${isUnlocked ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}` }), _jsx("span", { className: `text-xs font-semibold ${isUnlocked ? 'text-emerald-400' : 'text-slate-300'}`, children: currentAccount || savedAccount || t.wallet_locked })] }), _jsxs("select", { value: lang, onChange: (e) => setLang(e.target.value), className: "bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none", children: [_jsx("option", { value: "zh", children: "\uD83C\uDDE8\uD83C\uDDF3 \u7B80\u4F53\u4E2D\u6587" }), _jsx("option", { value: "en", children: "\uD83C\uDDFA\uD83C\uDDF8 English" }), _jsx("option", { value: "ru", children: "\uD83C\uDDF7\uD83C\uDDFA \u0420\u0443\u0441\u0441\u043A\u0438\u0439" })] })] })] }), _jsxs("div", { className: "flex flex-1 overflow-hidden", children: [_jsxs("aside", { className: "w-52 bg-[#111827] border-r border-slate-800/80 p-3 flex flex-col justify-between", children: [_jsx("nav", { className: "space-y-1", children: [
                                    { id: 'auth', label: t.nav_vault, icon: '🔑' },
                                    { id: 'gateway', label: t.nav_gateway, icon: '🛡️' },
                                    { id: 'otp', label: t.nav_otp, icon: '⚡' },
                                    { id: 'rules', label: t.nav_rules, icon: '⚙️' },
                                    { id: 'logs', label: t.nav_logs, icon: '📋' },
                                ].map((tab) => (_jsxs("button", { onClick: () => setActiveTab(tab.id), className: `w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800/60'}`, children: [_jsx("span", { children: tab.icon }), _jsx("span", { children: tab.label })] }, tab.id))) }), _jsxs("div", { className: "bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60 text-[11px] text-slate-500", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { children: t.core_engine }), _jsx("span", { className: isGwRunning ? 'text-emerald-400' : 'text-rose-400', children: isGwRunning ? 'Online' : 'Stopped' })] }), _jsx("div", { children: "BTSBots TS Engine" })] })] }), _jsxs("main", { className: "flex-1 p-6 overflow-y-auto bg-[#0b0f19]", children: [activeTab === 'auth' && (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold", children: t.vault_title }), _jsx("p", { className: "text-xs text-slate-400 mt-0.5", children: t.vault_desc })] }), hasKeystore && (_jsxs("div", { className: "bg-[#151d30]/70 backdrop-blur border border-blue-500/20 rounded-2xl p-6 max-w-lg space-y-4 shadow-xl", children: [_jsx("div", { className: "flex justify-between items-center", children: _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20", children: "\uD83D\uDD11" }), _jsxs("div", { children: [_jsx("h3", { className: "font-bold text-sm", children: t.vault_unlock_title }), _jsxs("p", { className: "text-xs text-slate-400 font-mono", children: ["\u5DF2\u7ED1\u5B9A\u8D26\u53F7: [", savedAccount, "]"] })] })] }) }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs text-slate-400 mb-1.5", children: t.label_pass }), _jsx("input", { type: "password", value: unlockPassword, onChange: (e) => setUnlockPassword(e.target.value), onKeyDown: (e) => e.key === 'Enter' && handleUnlock(), placeholder: "\u8F93\u5165\u4E3B\u4FDD\u62A4\u53E3\u4EE4", className: "w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500" })] }), _jsx("button", { onClick: handleUnlock, className: "bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-6 py-2.5 rounded-xl shadow-md transition", children: t.btn_unlock })] })), _jsxs("div", { className: "grid grid-cols-2 gap-4 max-w-3xl pt-2", children: [_jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 rounded-2xl p-5 space-y-3 shadow-xl", children: [_jsx("h4", { className: "font-bold text-xs", children: t.vault_import_title }), _jsxs("div", { children: [_jsx("input", { type: "file", ref: fileInputRef, accept: ".txt", onChange: handleFileSelect, className: "hidden" }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("input", { type: "text", readOnly: true, value: importFileName, placeholder: "\u672A\u9009\u62E9\u51ED\u636E\u6587\u4EF6 (credentials.txt)", className: "flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 truncate" }), _jsx("button", { type: "button", onClick: () => fileInputRef.current?.click(), className: "bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shadow-sm transition", children: t.btn_browse })] })] }), _jsx("div", { children: _jsx("input", { type: "password", placeholder: t.label_set_pass, value: importPassword, onChange: (e) => setImportPassword(e.target.value), className: "w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500" }) }), _jsx("button", { onClick: handleImportSave, className: "w-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2 rounded-xl transition border border-slate-700", children: t.btn_encrypt_save })] }), _jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 rounded-2xl p-5 space-y-3 shadow-xl", children: [_jsx("h4", { className: "font-bold text-xs", children: t.vault_reg_title }), _jsx("input", { type: "text", placeholder: "\u9080\u8BF7\u7801 (Invite Code)", value: regInvite, onChange: (e) => setRegInvite(e.target.value), className: "w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100" }), _jsx("input", { type: "text", placeholder: "\u65B0\u7528\u6237\u540D (8-30\u4F4D\u5C0F\u5199\u82F1\u6587\u5F00\u5934)", value: regUsername, onChange: (e) => setRegUsername(e.target.value), className: "w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100" }), _jsx("input", { type: "password", placeholder: "\u8BBE\u5B9A\u4FDD\u62A4\u5BC6\u7801 (\u81F3\u5C116\u4F4D)", value: regPassword, onChange: (e) => setRegPassword(e.target.value), className: "w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100" }), _jsx("button", { onClick: handleRegister, className: "w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 rounded-xl transition shadow-md shadow-emerald-600/20", children: t.btn_register_submit })] })] })] })), activeTab === 'gateway' && (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold", children: t.gw_title }), _jsx("p", { className: "text-xs text-slate-400 mt-0.5", children: t.gw_desc })] }), _jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 rounded-2xl p-5 flex items-center justify-between shadow-xl", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("div", { className: `w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold ${isGwRunning ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'}`, children: isGwRunning ? '▶' : '⏹' }), _jsxs("div", { children: [_jsx("div", { className: "text-[11px] font-semibold text-slate-400 uppercase", children: t.gw_status_label }), _jsx("div", { className: `text-lg font-bold ${isGwRunning ? 'text-emerald-400' : 'text-rose-400'}`, children: isGwRunning ? t.gw_running : t.gw_stopped })] })] }), _jsx("button", { onClick: toggleGateway, className: `text-xs font-semibold px-5 py-2.5 rounded-xl shadow-lg transition ${isGwRunning ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'}`, children: isGwRunning ? t.gw_btn_stop : t.gw_btn_start })] })] })), activeTab === 'otp' && (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold", children: t.otp_title }), _jsx("p", { className: "text-xs text-slate-400 mt-0.5", children: t.otp_desc })] }), _jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 rounded-2xl p-6 max-w-sm mx-auto flex flex-col items-center space-y-4 shadow-xl", children: [_jsxs("div", { className: "text-xs text-slate-400 font-medium flex items-center space-x-1.5", children: [_jsx("span", { children: t.otp_label }), otpTimer !== null && _jsxs("span", { className: "text-[10px] text-blue-400 font-mono", children: ["(", otpTimer, "s)"] })] }), _jsxs("div", { className: "w-full flex items-center justify-between bg-slate-900 border border-slate-700/80 rounded-xl px-5 py-3", children: [_jsx("div", { className: "font-mono text-2xl font-bold tracking-[0.2em] text-amber-400", children: otpCode }), _jsx("button", { onClick: handleCopyOtp, className: "text-xs px-2.5 py-1.5 bg-slate-800 rounded-lg border border-slate-700 hover:bg-slate-700 text-slate-200 transition", children: "\u590D\u5236" })] }), _jsx("button", { onClick: fetchOtp, className: "w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2.5 rounded-xl shadow-md transition", children: t.otp_refresh_btn })] })] })), activeTab === 'rules' && rules && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold", children: t.rules_title }), _jsx("p", { className: "text-xs text-slate-400 mt-0.5", children: t.rules_desc })] }), _jsxs("div", { className: "flex space-x-2", children: [_jsx("button", { onClick: exportRulesJson, className: "bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-xl border border-slate-700 transition", children: "\u5BFC\u51FA JSON" }), _jsx("button", { onClick: saveRulesToLocal, className: "bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-1.5 rounded-xl shadow-md transition", children: t.btn_save_rules })] })] }), _jsx("div", { className: "flex border-b border-slate-800 space-x-6 text-xs text-slate-400", children: ['devices', 'unlimited', 'micro', 'trading'].map((st) => (_jsx("button", { onClick: () => setRulesSubTab(st), className: `pb-2 transition ${rulesSubTab === st ? 'border-b-2 border-blue-500 text-blue-400 font-bold' : 'hover:text-slate-200'}`, children: t[`rules_tab_${st}`] }, st))) }), rulesSubTab === 'devices' && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "bg-[#151d30]/70 border border-blue-500/30 p-3.5 rounded-xl flex items-center justify-between shadow-lg", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-bold text-slate-200", children: t.global_fee_title }), _jsx("div", { className: "text-[11px] text-slate-400", children: t.global_fee_desc })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("input", { type: "number", value: rules.fee_limit, onChange: (e) => setRules({ ...rules, fee_limit: parseFloat(e.target.value) || 0 }), className: "bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-xs w-28 text-emerald-400 font-mono focus:outline-none focus:border-blue-500" }), _jsx("span", { className: "text-xs font-semibold text-slate-400", children: "BTS" })] })] }), _jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "font-semibold text-xs text-slate-200", children: t.devices_table_title }), _jsxs("button", { onClick: () => {
                                                                    const fp = prompt('请输入设备公钥指纹 (SHA-256 前50位):');
                                                                    if (!fp)
                                                                        return;
                                                                    const alias = prompt('请输入设备别名 (Alias, 如 phone-wallet):');
                                                                    if (!alias)
                                                                        return;
                                                                    setRules({
                                                                        ...rules,
                                                                        public_keys: { ...rules.public_keys, [fp.trim()]: alias.trim() },
                                                                    });
                                                                }, className: "bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 px-3 py-1 rounded-lg text-xs", children: ["+ ", t.btn_add_device] })] }), _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-slate-400 border-b border-slate-800", children: [_jsx("th", { className: "py-1 px-2 text-left", children: t.th_fingerprint }), _jsx("th", { className: "py-1 px-2 text-left", children: t.th_alias }), _jsx("th", { className: "py-1 px-2 text-center", children: t.th_oauth }), _jsx("th", { className: "py-1 px-2 text-right", children: t.th_actions })] }) }), _jsx("tbody", { children: Object.entries(rules.public_keys).map(([fp, alias]) => (_jsxs("tr", { className: "border-b border-slate-800/40 hover:bg-slate-800/20", children: [_jsx("td", { className: "py-1.5 px-2 font-mono text-[11px] text-slate-300", children: fp }), _jsx("td", { className: "py-1.5 px-2 font-semibold text-slate-200", children: alias }), _jsx("td", { className: "py-1.5 px-2 text-center", children: _jsx("input", { type: "checkbox", checked: rules.oauth_allowed_devices.includes(alias), onChange: (e) => {
                                                                                    const newOauth = e.target.checked
                                                                                        ? [...rules.oauth_allowed_devices, alias]
                                                                                        : rules.oauth_allowed_devices.filter((a) => a !== alias);
                                                                                    setRules({ ...rules, oauth_allowed_devices: newOauth });
                                                                                } }) }), _jsx("td", { className: "py-1.5 px-2 text-right", children: _jsx("button", { onClick: () => {
                                                                                    const copy = { ...rules.public_keys };
                                                                                    delete copy[fp];
                                                                                    setRules({
                                                                                        ...rules,
                                                                                        public_keys: copy,
                                                                                        oauth_allowed_devices: rules.oauth_allowed_devices.filter((a) => a !== alias),
                                                                                    });
                                                                                }, className: "text-rose-400 hover:text-rose-300 font-semibold", children: "\u2715 \u5220\u9664" }) })] }, fp))) })] })] })] })), rulesSubTab === 'unlimited' && (_jsxs("div", { className: "space-y-4 text-xs", children: [_jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "font-semibold text-slate-200", children: t.unlimited_devices_title }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("select", { id: "unlimitedDevSelect", className: "bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200", children: getKnownAliases().map((a) => (_jsx("option", { value: a, children: a }, a))) }), _jsx("button", { onClick: () => {
                                                                            const sel = document.getElementById('unlimitedDevSelect')?.value;
                                                                            if (!sel)
                                                                                return;
                                                                            if (!rules.unlimited_payments.authorized_devices.includes(sel)) {
                                                                                setRules({
                                                                                    ...rules,
                                                                                    unlimited_payments: {
                                                                                        ...rules.unlimited_payments,
                                                                                        authorized_devices: [...rules.unlimited_payments.authorized_devices, sel],
                                                                                    },
                                                                                });
                                                                            }
                                                                        }, className: "bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg", children: t.btn_add })] })] }), _jsx("div", { className: "flex flex-wrap gap-2", children: rules.unlimited_payments.authorized_devices.map((d) => (_jsxs("span", { className: "bg-blue-900/40 text-blue-300 border border-blue-700/60 px-2.5 py-1 rounded-lg flex items-center space-x-2", children: [_jsx("span", { children: d }), _jsx("button", { onClick: () => {
                                                                        setRules({
                                                                            ...rules,
                                                                            unlimited_payments: {
                                                                                ...rules.unlimited_payments,
                                                                                authorized_devices: rules.unlimited_payments.authorized_devices.filter((x) => x !== d),
                                                                            },
                                                                        });
                                                                    }, className: "text-rose-400 font-bold", children: "\u2715" })] }, d))) })] }), _jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsxs("div", { children: [_jsx("span", { className: "font-semibold text-slate-200", children: t.unlimited_recipients_title }), _jsx("p", { className: "text-[11px] text-slate-400 mt-0.5", children: "\u652F\u6301\u4E3A\u4EA4\u6613\u6240\u7B49\u6307\u5B9A\u5FC5\u586B Memo \u9644\u8A00\uFF1B\u7559\u7A7A\u5219\u8868\u793A\u5141\u8BB8\u4EFB\u610F\u9644\u8A00\u3002" })] }), _jsxs("button", { onClick: () => {
                                                                    const acc = prompt('请输入收款人用户名 (如 bts-binance):');
                                                                    if (!acc)
                                                                        return;
                                                                    const id = prompt('请输入对应的 BitShares 账号 ID (如 1.2.31073):');
                                                                    if (!id)
                                                                        return;
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
                                                                }, className: "bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 px-3 py-1 rounded-lg text-xs", children: ["+ ", t.btn_add_recipient] })] }), _jsx("div", { className: "space-y-2", children: Object.entries(rules.unlimited_payments.recipient_whitelist).map(([acc, rule]) => {
                                                            const idStr = typeof rule === 'object' ? rule.id : rule;
                                                            const memoStr = typeof rule === 'object' ? (rule.required_memo || '') : '';
                                                            return (_jsxs("div", { className: "flex items-center space-x-2 bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800", children: [_jsx("span", { className: "text-slate-400", children: "\u8D26\u6237:" }), _jsx("span", { className: "font-bold text-slate-200 w-28 truncate", children: acc }), _jsx("span", { className: "text-slate-400", children: "ID:" }), _jsx("input", { type: "text", value: idStr, onChange: (e) => {
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
                                                                        }, className: "bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-emerald-400 font-mono w-24 focus:outline-none" }), _jsx("span", { className: "text-slate-400", children: "\u9650\u5B9A\u9644\u8A00 (Memo):" }), _jsx("input", { type: "text", value: memoStr, placeholder: "\u65E0 (\u5141\u8BB8\u4EFB\u610F\u9644\u8A00)", onChange: (e) => {
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
                                                                        }, className: "flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-amber-400 font-mono text-xs focus:outline-none" }), _jsx("button", { onClick: () => {
                                                                            const copy = { ...rules.unlimited_payments.recipient_whitelist };
                                                                            delete copy[acc];
                                                                            setRules({
                                                                                ...rules,
                                                                                unlimited_payments: { ...rules.unlimited_payments, recipient_whitelist: copy },
                                                                            });
                                                                        }, className: "text-rose-400 hover:text-rose-300 font-semibold px-2", children: "\u2715 \u5220\u9664" })] }, acc));
                                                        }) })] })] })), rulesSubTab === 'micro' && (_jsxs("div", { className: "space-y-4 text-xs", children: [_jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "font-semibold text-slate-200", children: t.micro_base_title }), _jsxs("button", { onClick: () => {
                                                                    const coin = prompt('请输入资产代码 (如 CNY, BTS, USD):');
                                                                    if (!coin)
                                                                        return;
                                                                    const val = parseFloat(prompt('请输入单笔基准额度:') || '100');
                                                                    setRules({
                                                                        ...rules,
                                                                        micro_payments: {
                                                                            ...rules.micro_payments,
                                                                            base_limits: { ...rules.micro_payments.base_limits, [coin.toUpperCase().trim()]: val },
                                                                        },
                                                                    });
                                                                }, className: "bg-blue-600/20 text-blue-400 border border-blue-500/30 px-3 py-1 rounded-lg text-xs", children: ["+ ", t.btn_add_coin] })] }), _jsx("div", { className: "grid grid-cols-3 gap-3", children: Object.entries(rules.micro_payments.base_limits).map(([coin, limit]) => (_jsxs("div", { className: "flex items-center justify-between bg-slate-900/80 px-3 py-2 rounded-lg border border-slate-800", children: [_jsx("span", { className: "font-bold text-slate-300", children: coin }), _jsx("input", { type: "number", value: limit, onChange: (e) => {
                                                                        const val = parseFloat(e.target.value) || 0;
                                                                        setRules({
                                                                            ...rules,
                                                                            micro_payments: {
                                                                                ...rules.micro_payments,
                                                                                base_limits: { ...rules.micro_payments.base_limits, [coin]: val },
                                                                            },
                                                                        });
                                                                    }, className: "bg-transparent text-right text-emerald-400 font-mono w-20 focus:outline-none" }), _jsx("button", { onClick: () => {
                                                                        const copy = { ...rules.micro_payments.base_limits };
                                                                        delete copy[coin];
                                                                        setRules({
                                                                            ...rules,
                                                                            micro_payments: { ...rules.micro_payments, base_limits: copy },
                                                                        });
                                                                    }, className: "text-rose-400 font-bold px-1", children: "\u2715" })] }, coin))) })] }), _jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl", children: [_jsx("span", { className: "font-semibold text-slate-200", children: t.micro_dev_rules_title }), _jsxs("table", { className: "w-full text-xs", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-slate-400 border-b border-slate-800", children: [_jsx("th", { className: "py-1 px-2 text-left", children: t.th_device }), _jsx("th", { className: "py-1 px-2", children: t.th_single_mult }), _jsx("th", { className: "py-1 px-2", children: t.th_day_mult }), _jsx("th", { className: "py-1 px-2", children: t.th_week_mult }), _jsx("th", { className: "py-1 px-2", children: t.th_pin })] }) }), _jsx("tbody", { children: Object.entries(rules.micro_payments.device_rules).map(([dev, devRule]) => (_jsxs("tr", { className: "border-b border-slate-800/40", children: [_jsx("td", { className: "py-1.5 px-2 font-semibold text-slate-200", children: dev }), _jsx("td", { className: "py-1.5 px-2 text-center", children: _jsx("input", { type: "number", step: "0.1", value: devRule.single_multiplier, onChange: (e) => {
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
                                                                                }, className: "bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 w-16 text-emerald-400 text-center" }) }), _jsx("td", { className: "py-1.5 px-2 text-center", children: _jsx("input", { type: "number", step: "1", value: devRule.day_max_multiplier, onChange: (e) => {
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
                                                                                }, className: "bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 w-16 text-emerald-400 text-center" }) }), _jsx("td", { className: "py-1.5 px-2 text-center", children: _jsx("input", { type: "number", step: "1", value: devRule.week_max_multiplier, onChange: (e) => {
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
                                                                                }, className: "bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 w-16 text-emerald-400 text-center" }) }), _jsx("td", { className: "py-1.5 px-2 text-center", children: _jsx("input", { type: "text", value: devRule.pin !== undefined ? String(devRule.pin) : '', placeholder: "\u65E0", onChange: (e) => {
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
                                                                                }, className: "bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 w-20 text-amber-400 font-mono text-center" }) })] }, dev))) })] })] })] })), rulesSubTab === 'trading' && (_jsxs("div", { className: "space-y-4 text-xs", children: [_jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl", children: [_jsx("span", { className: "font-semibold text-slate-200", children: t.volatility_title }), _jsxs("div", { className: "grid grid-cols-3 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-slate-400 mb-1", children: "1\u5C0F\u65F6\u504F\u79BB\u5EA6 (1h Limit)" }), _jsx("input", { type: "number", step: "0.01", value: rules.trading_risk.volatility_limit_1h, onChange: (e) => setRules({
                                                                            ...rules,
                                                                            trading_risk: { ...rules.trading_risk, volatility_limit_1h: parseFloat(e.target.value) || 0.97 },
                                                                        }), className: "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-emerald-400 font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-400 mb-1", children: "1\u5929\u504F\u79BB\u5EA6 (1d Limit)" }), _jsx("input", { type: "number", step: "0.01", value: rules.trading_risk.volatility_limit_1d, onChange: (e) => setRules({
                                                                            ...rules,
                                                                            trading_risk: { ...rules.trading_risk, volatility_limit_1d: parseFloat(e.target.value) || 0.95 },
                                                                        }), className: "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-emerald-400 font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-400 mb-1", children: "1\u5468\u504F\u79BB\u5EA6 (1w Limit)" }), _jsx("input", { type: "number", step: "0.01", value: rules.trading_risk.volatility_limit_1w, onChange: (e) => setRules({
                                                                            ...rules,
                                                                            trading_risk: { ...rules.trading_risk, volatility_limit_1w: parseFloat(e.target.value) || 0.90 },
                                                                        }), className: "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-emerald-400 font-mono" })] })] })] }), _jsxs("div", { className: "bg-[#151d30]/70 border border-white/5 p-4 rounded-xl space-y-3 shadow-xl", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "font-semibold text-slate-200", children: t.market_whitelist_title }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("input", { type: "text", placeholder: "\u4F8B\u5982: CNY/BTS", value: newMarket, onChange: (e) => setNewMarket(e.target.value.toUpperCase()), className: "bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-xs text-slate-200 uppercase w-28" }), _jsx("button", { onClick: () => {
                                                                            if (!newMarket)
                                                                                return;
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
                                                                        }, className: "bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded-lg", children: t.btn_add })] })] }), _jsx("div", { className: "flex flex-wrap gap-2", children: rules.trading_risk.market_whitelist.map((m) => (_jsxs("span", { className: "bg-slate-800 text-slate-200 border border-slate-700 px-2.5 py-1 rounded-lg flex items-center space-x-2 font-mono", children: [_jsx("span", { children: m }), _jsx("button", { onClick: () => {
                                                                        setRules({
                                                                            ...rules,
                                                                            trading_risk: {
                                                                                ...rules.trading_risk,
                                                                                market_whitelist: rules.trading_risk.market_whitelist.filter((x) => x !== m),
                                                                            },
                                                                        });
                                                                    }, className: "text-rose-400 font-bold", children: "\u2715" })] }, m))) })] })] }))] })), activeTab === 'logs' && (_jsxs("div", { className: "space-y-3 flex flex-col h-full", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsx("h2", { className: "text-xl font-bold", children: t.logs_title }), _jsx("button", { onClick: () => setLogs([]), className: "bg-slate-800 hover:bg-slate-700 text-xs px-2.5 py-1 rounded-lg border border-slate-700", children: t.btn_clear_logs })] }), _jsx("div", { className: "flex-1 bg-[#070b13] border border-slate-800/80 rounded-xl p-3.5 font-mono text-xs text-emerald-400 overflow-y-auto", children: logs.map((log, index) => (_jsx("div", { className: "py-0.5 leading-relaxed", children: log }, index))) })] }))] })] })] }));
}
