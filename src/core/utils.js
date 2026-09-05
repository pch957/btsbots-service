/**
 * 校验 BitShares 用户名规范 (8 - 30 位小写英文开头规范)
 */
export function validateBtsUsername(username) {
    if (typeof username !== 'string') {
        return { valid: false, message: '用户名必须是字符串' };
    }
    const clean = username.trim();
    if (clean.length < 8 || clean.length > 30) {
        return { valid: false, message: '账户名长度必须在 8 到 30 个字符之间' };
    }
    if (!/^[a-z]/.test(clean)) {
        return { valid: false, message: '账户名必须以英文小写字母（a-z）开头' };
    }
    if (clean.includes('--')) {
        return { valid: false, message: '账户名中不能包含连续的连字符（--）' };
    }
    if (clean.endsWith('-')) {
        return { valid: false, message: '账户名不能以连字符（-）结尾' };
    }
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(clean)) {
        return { valid: false, message: '账户名仅允许包含小写字母 (a-z)、数字 (0-9) 以及非连续的连字符 (-)' };
    }
    if (clean.includes('.') || clean.includes('_') || clean.includes(' ')) {
        return { valid: false, message: '账户名不能包含点（.）、下划线（_）或空格' };
    }
    return { valid: true, message: '校验通过' };
}
export function bufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
export function hexToBuffer(hexString) {
    const cleanHex = hexString.replace(/^0x/, '');
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
    }
    return bytes;
}
/**
 * 跨浏览器/局域网 HTTP 安全剪贴板复制工具
 */
export async function copyToClipboard(text) {
    if (!text)
        return false;
    // 1. 尝试现代 Clipboard API
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        }
        catch {
            // 若受限则降级
        }
    }
    // 2. 降级方案：创建不可见 textarea + execCommand
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
    }
    catch (err) {
        console.error('Copy fallback failed:', err);
        return false;
    }
}
