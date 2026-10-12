// ======================================================================
// 默认优选IP列表 / 默认优选API源
// 说明：这两处现在只是「兜底默认值」，部署后可以直接在网页上填写，
//      网页填写的内容会保存到 Cloudflare KV（绑定变量名 SUB_KV），
//      没绑定 KV 时会随订阅链接一起传递，因此代码里可以留空。
//      格式： "IP:端口#备注"（每行一个）；API 源为链接，可留空。
// ======================================================================
let cfips = [
    // 留空即可，网页上填写优先
];

let cfips_api = [
    // 留空即可，网页上填写优先
];

// Cloudflare KV 绑定名：Worker → 设置 → 变量和机密 → KV 命名空间绑定，变量名填 SUB_KV
const KV_NAME = 'SUB_KV';

// 把网页上填写的多行文本转成数组（支持换行/逗号分隔，忽略 # 与 // 注释行）
function textToArray(text) {
    if (!text) return [];
    return text.split(/[\r\n,]+/)
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('#') && !s.startsWith('//'));
}

// 链接参数可能是 Base64（网页自动生成），也可能是明文
function decodeTextParam(s) {
    if (!s) return '';
    try {
        const d = atob(s);
        if (d && /[\x20-\x7E]/.test(d)) {
            try { return decodeURIComponent(escape(d)); } catch (e) { return d; }
        }
    } catch (e) { /* 不是 base64，按明文处理 */ }
    return s;
}

// 取生效的地址列表：链接参数 > KV > 代码默认值
async function getAddressConfig(url, env) {
    let ipsText = decodeTextParam(url.searchParams.get('ips'));
    let apiText = decodeTextParam(url.searchParams.get('api'));

    if ((!ipsText || !apiText) && env && env[KV_NAME]) {
        try {
            if (!ipsText) ipsText = (await env[KV_NAME].get('cfips')) || '';
            if (!apiText) apiText = (await env[KV_NAME].get('cfips_api')) || '';
        } catch (e) {
            console.error('KV read error:', e);
        }
    }

    return {
        ips: ipsText ? textToArray(ipsText) : cfips.filter(Boolean),
        api: apiText ? textToArray(apiText) : cfips_api.filter(Boolean)
    };
}

// Base64 encoding function
function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

// Validate IPv4 address
function isValidIPv4(address) {
    const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(address);
}

// Validate domain name
function isValidDomain(domain) {
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return domainRegex.test(domain) && domain.length <= 253;
}

// Validate IPv6 address
function isValidIPv6(address) {
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    return ipv6Regex.test(address);
}

// Process API addresses
async function organizeCFIPList(api) {
    if (!api || api.length === 0) return [];

    let newapi = "";

    // Create an AbortController object to control fetch request cancellation
    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort(); 
    }, 5000); // Trigger after 5 seconds

    try {
        // Use Promise.allSettled to wait for all API requests to complete, regardless of success or failure
        // Traverse the api array and initiate fetch requests for each API address
        const responses = await Promise.allSettled(api.map(apiUrl => fetch(apiUrl, {
            method: 'get',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;',
                'User-Agent': 'curl/7.79.1'
            },
            signal: controller.signal 
        }).then(response => response.ok ? response.text() : Promise.reject())));

        // Traverse all responses
        for (const [index, response] of responses.entries()) {
            // Check if the response status is 'fulfilled', i.e., the request was successfully completed
            if (response.status === 'fulfilled') {
                // Get the content of the response
                const content = await response.value;

                const lines = content.split(/\r?\n/);
                let nodeRemark = '';
                let speedPort = '443';

                if (lines[0].split(',').length > 3) {
                    const idMatch = api[index].match(/id=([^&]*)/);
                    if (idMatch) nodeRemark = idMatch[1];

                    const portMatch = api[index].match(/port=([^&]*)/);
                    if (portMatch) speedPort = portMatch[1];

                    for (let i = 1; i < lines.length; i++) {
                        const columns = lines[i].split(',')[0];
                        if (columns) {
                            newapi += `${columns}:${speedPort}${nodeRemark ? `#${nodeRemark}` : ''}\n`;
                        }
                    }
                } else {
                    // Add the content to newapi
                    newapi += content + '\n';
                }
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        // Regardless of success or failure, finally clear the set timeout timer
        clearTimeout(timeout);
    }

    const newAddressesapi = await organize(newapi);

    // Return the processed result
    return newAddressesapi;
}

// Process addresses function
async function organize(content) {
    var replacedContent = content.replace(/[	|"'\r\n]+/g, ',').replace(/,+/g, ',');
    if (replacedContent.charAt(0) == ',') replacedContent = replacedContent.slice(1);
    if (replacedContent.charAt(replacedContent.length - 1) == ',') replacedContent = replacedContent.slice(0, replacedContent.length - 1);
    const addressArray = replacedContent.split(',');

    return addressArray;
}

// ======================================================================
// 解析单条节点链接 -> 生成节点所需的参数（解析失败会抛异常）
// ======================================================================
function parseNodeLink(linkParam, url) {
    let host = "";
    let uuid = "";
    let path = "/?ed=2560";
    let sni = "";
    let type = "ws";
    let protocolType = 'VLESS';
    let security = 'tls';
    let encryption = 'none';
    let mode = "";
    let remark = "";
    let ssPluginParam = "";

    if (linkParam.startsWith('vmess://')) {
        const vmessLink = linkParam.split('vmess://')[1];
        // atob 得到的是 latin1 字符串，中文备注会乱码，这里转回 UTF-8
        let vmessRaw = atob(vmessLink);
        try { vmessRaw = decodeURIComponent(escape(vmessRaw)); } catch (e) { /* 非 UTF-8 时保持原样 */ }
        const vmessJson = JSON.parse(vmessRaw);
        
        host = vmessJson.host || vmessJson.add;
        uuid = vmessJson.id;
        path = vmessJson.path || '/';
        sni = vmessJson.sni || host;
        type = vmessJson.net || 'ws'; // Use net field for type, default to 'ws'
        security = vmessJson.tls === true || vmessJson.tls === 'true' || vmessJson.tls === 'tls' ? 'tls' : 'none';
        encryption = vmessJson.scy || 'auto';
        protocolType = 'VMess';
        remark = vmessJson.ps || '';
    } else if (linkParam.startsWith('vless://')) {
        // Parse VLESS link
        // Split by ? to separate URL part and parameters
        const [urlPart, paramsPart] = linkParam.split('?');
        
        // Extract UUID and host from URL part
        const urlWithoutProtocol = urlPart.substring(8); 
        const [uuidAndHostPart, tagPart] = urlWithoutProtocol.split('#'); // Split by # to separate tag
        const [uuidPart, hostAndPortPart] = uuidAndHostPart.split('@');
        
        uuid = decodeURIComponent(uuidPart);
        const originalHost = hostAndPortPart.split(':')[0]; // Store original host
        protocolType = 'VLESS';
        // 原链接备注：优先取 ? 之后的 #tag，其次取 url 部分的 #tag
        const rawTag = (paramsPart && paramsPart.includes('#')) ? paramsPart.split('#')[1] : tagPart;
        remark = rawTag ? decodeURIComponent(rawTag) : '';
        
        // Parse query parameters
        if (paramsPart) {
            // Remove the tag part if it exists after parameters
            const cleanParamsPart = paramsPart.split('#')[0];
            const params = new URLSearchParams(cleanParamsPart);
            path = params.get('path') || '/';
            sni = params.get('sni') || originalHost;
            type = params.get('type') || 'ws';
            security = params.get('security') || 'tls';
            host = params.get('host') || originalHost;
            
            // Check for XHTTP protocol with mode parameter
            if (type === 'xhttp' && (params.get('mode') === 'packet-up' || params.get('mode') === 'stream-one')) {
                protocolType = 'XHTTP';
                mode = params.get('mode'); 
            }
        } else {
            // Set default values if no parameters
            path = '/';
            sni = originalHost;
            type = 'ws';
            security = 'tls';
            host = originalHost;
        }
    } else if (linkParam.startsWith('trojan://')) {
        // Parse Trojan link
        // Split by ? to separate URL part and parameters
        const [urlPart, paramsPart] = linkParam.split('?');
        
        // Extract UUID and host from URL part
        const urlWithoutProtocol = urlPart.substring(9); 
        const [uuidAndHostPart, tagPart] = urlWithoutProtocol.split('#'); // Split by # to separate tag
        const [uuidPart, hostAndPortPart] = uuidAndHostPart.split('@');
        
        uuid = decodeURIComponent(uuidPart);
        const originalHost = hostAndPortPart.split(':')[0]; // Store original host
        protocolType = 'Trojan';
        // 原链接备注：优先取 ? 之后的 #tag，其次取 url 部分的 #tag
        const rawTag = (paramsPart && paramsPart.includes('#')) ? paramsPart.split('#')[1] : tagPart;
        remark = rawTag ? decodeURIComponent(rawTag) : '';
        
        // Parse query parameters
        if (paramsPart) {
            // Remove the tag part if it exists after parameters
            const cleanParamsPart = paramsPart.split('#')[0];
            const params = new URLSearchParams(cleanParamsPart);
            path = params.get('path') || '/';
            sni = params.get('sni') || originalHost;
            type = params.get('type') || 'ws';
            security = params.get('security') || 'tls';
            host = params.get('host') || originalHost;
        } else {
            // Set default values if no parameters
            path = '/';
            sni = originalHost;
            type = 'ws';
            security = 'tls';
            host = originalHost;
        }
    } else if (linkParam.startsWith('ss://')) {
        // Parse Shadowsocks link
        protocolType = 'SS';
        
        // First, separate the base64 part from the rest
        const linkWithoutPrefix = linkParam.substring(5); // Remove 'ss://'
        let ssLink = '';
        let hostPortAndParams = '';
        
        // Find the @ separator
        const atIndex = linkWithoutPrefix.indexOf('@');
        if (atIndex > 0) {
            ssLink = linkWithoutPrefix.substring(0, atIndex);
            hostPortAndParams = linkWithoutPrefix.substring(atIndex + 1);
        }
        
        // Extract tag if present
        let tag = '';
        if (hostPortAndParams.includes('#')) {
            const parts = hostPortAndParams.split('#');
            hostPortAndParams = parts[0];
            tag = decodeURIComponent(parts[1]);
            remark = tag;
        }
        
        // Extract plugin parameter if present
        let pluginParam = '';
        if (hostPortAndParams.includes('?plugin=')) {
            const pluginStart = hostPortAndParams.indexOf('?plugin=');
            pluginParam = hostPortAndParams.substring(pluginStart + 1);
            hostPortAndParams = hostPortAndParams.substring(0, pluginStart);
        }
        
        if (hostPortAndParams) {
            // Extract host and port
            const hostPortParts = hostPortAndParams.split(':');
            host = hostPortParts[0];
            
            // Decode the base64 part to get method and password
            try {
                const decodedUserInfo = atob(ssLink);
                const [method, password] = decodedUserInfo.split(':');
                encryption = method;
                uuid = password;
            } catch (e) {
                console.error('Base64 decode error:', e);
                // If base64 decode fails, try to parse as method:password directly
                const [method, password] = ssLink.split(':');
                encryption = method;
                uuid = password;
            }
            
            // For Shadowsocks with plugin, we need to extract more info
            if (pluginParam) {
                // Extract path, host, etc. from plugin param
                const pluginDecoded = decodeURIComponent(pluginParam.replace('plugin=', ''));
                const pluginParts = pluginDecoded.split(';');
                
                // Look for path and host in plugin parameters
                for (const part of pluginParts) {
                    if (part.startsWith('path=')) {
                        path = decodeURIComponent(part.substring(5));
                    } else if (part.startsWith('host=')) {
                        sni = decodeURIComponent(part.substring(5));
                    }
                }
                
                // Save the plugin parameter for link generation
                // We need to store it in a way that it's accessible later
                ssPluginParam = pluginParam;
            }
            
            // Set defaults if not extracted from plugin
            if (!path) path = '/';
            if (!sni) sni = host;
            type = 'ws';
            security = 'tls';
        }
    }

    if (!host || !uuid) {
        throw new Error('Unrecognized link format: ' + linkParam.substring(0, 32));
    }

    return { host, uuid, path, sni, type, protocolType, security, encryption, mode, remark, ssPluginParam };
}

// ======================================================================
// 把一个优选地址项（"IP:端口#备注" / "域名:端口#备注" / IPv6）拆开
// ======================================================================
function parseAddressEntry(addressInfo) {
    let addressPart = '';
    let portPart = '';
    let remark = '';

    if (addressInfo.startsWith('[') && addressInfo.includes(']:')) {
        const endIndex = addressInfo.indexOf(']:');
        addressPart = addressInfo.substring(1, endIndex);
        const remaining = addressInfo.substring(endIndex + 2);
        [portPart, remark] = remaining.split('#');
    } else if (addressInfo.includes('#') && addressInfo.split(':')[2]) {
        const parts = addressInfo.split('#');
        addressPart = parts[0];
        remark = parts[1];
        portPart = '443';
    } else if (addressInfo.split(':').length > 2) {
        const potentialIPv6 = addressInfo.includes('#') ? addressInfo.split('#')[0] : addressInfo;
        if (isValidIPv6(potentialIPv6)) {
            addressPart = potentialIPv6;
            portPart = '443';
            if (addressInfo.includes('#')) remark = addressInfo.split('#')[1];
        } else {
            let [addrPart, pPart] = addressInfo.split(':');
            addressPart = addrPart;
            if (pPart && pPart.includes('#')) {
                [portPart, remark] = pPart.split('#');
            } else {
                portPart = pPart;
            }
        }
    } else {
        const parts = addressInfo.split(':');
        addressPart = parts[0];
        if (parts.length > 1) {
            if (parts[1].includes('#')) {
                [portPart, remark] = parts[1].split('#');
            } else {
                portPart = parts[1];
            }
        }
        if (addressPart.includes('#')) {
            const [ip, tag] = addressPart.split('#');
            addressPart = ip;
            remark = tag;
        }
    }

    if (!portPart) portPart = '443';
    return { addressPart: addressPart, portPart: portPart, remark: remark || '' };
}

// ======================================================================
// 生成单条节点链接
// 备注规则：原链接备注 + " | " + 地址备注（两边都无备注则不写备注）
// ======================================================================
function buildNodeLink(np, addressInfo, url) {
    const parsedAddr = parseAddressEntry(addressInfo);
    const addressPart = parsedAddr.addressPart;
    const portPart = parsedAddr.portPart;
    const addrRemark = parsedAddr.remark;
    // IPv6 在 URL 里必须写成 [地址]，否则会被当成 "地址:端口" 解析错
    const addrInUrl = addressPart.includes(':') ? '[' + addressPart + ']' : addressPart;

    let finalRemark = '';
    if (np.remark && addrRemark) {
        finalRemark = np.remark + ' | ' + addrRemark;
    } else if (np.remark) {
        finalRemark = np.remark;
    } else if (addrRemark) {
        finalRemark = addrRemark;
    }
    const tag = finalRemark ? '#' + encodeURIComponent(finalRemark) : '';

    try {
        if (np.protocolType === 'VLESS') {
            return `vless://${np.uuid}@${addrInUrl}:${portPart}?encryption=${np.encryption}&security=${np.security}&sni=${np.sni}&type=${np.type}&host=${np.host}&path=${encodeURIComponent(np.path)}&fp=chrome${tag}`;
        } else if (np.protocolType === 'VMess') {
            const vmessObj = {
                "v": "2",
                "ps": finalRemark,
                "add": addressPart,
                "port": portPart,
                "id": np.uuid,
                "aid": "0",
                "scy": "auto",
                "net": np.type,
                "type": "none",
                "host": np.host,
                "path": np.path,
                "tls": np.security,
                "sni": np.sni,
                "fp": "chrome"
            };
            return `vmess://${utf8ToBase64(JSON.stringify(vmessObj))}`;
        } else if (np.protocolType === 'Trojan') {
            return `trojan://${np.uuid}@${addrInUrl}:${portPart}?security=${np.security}&type=${np.type}&host=${np.host}&path=${encodeURIComponent(np.path)}&sni=${np.sni}&fp=chrome${tag}`;
        } else if (np.protocolType === 'SS') {
            const ssUserInfo = `${np.encryption}:${np.uuid}`;
            const encodedUserInfo = btoa(ssUserInfo);
            if (np.ssPluginParam) {
                return `ss://${encodedUserInfo}@${addrInUrl}:${portPart}?${np.ssPluginParam}${tag}`;
            } else if (url.searchParams.has('plugin')) {
                const directPluginParam = url.searchParams.get('plugin');
                return `ss://${encodedUserInfo}@${addrInUrl}:${portPart}?${directPluginParam}${tag}`;
            } else {
                return `ss://${encodedUserInfo}@${addrInUrl}:${portPart}${tag}`;
            }
        } else if (np.protocolType === 'XHTTP') {
            let xhttpLink = `vless://${np.uuid}@${addrInUrl}:${portPart}?encryption=${np.encryption}&security=${np.security}&type=${np.type}&sni=${np.sni}&host=${np.host}&path=${encodeURIComponent(np.path)}&fp=chrome`;
            if (np.mode) {
                xhttpLink += `&mode=${np.mode}`;
            }
            return `${xhttpLink}${tag}`;
        } else {
            return `vless://${np.uuid}@${addrInUrl}:${portPart}?encryption=${np.encryption}&security=${np.security}&sni=${np.sni}&type=${np.type}&host=${np.host}&path=${encodeURIComponent(np.path)}&fp=chrome${tag}`;
        }
    } catch (error) {
        console.error('Error generating node link:', error);
        return '';
    }
}

// Frontend HTML page
const frontendHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preferred Subscription Generator</title>
    <style>
        :root {
            --primary-color: #4361ee;
            --hover-color: #3b4fd3;
            --bg-color: #f5f6fa;
            --card-bg: #ffffff;
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            margin-bottom: 5px;
        }
        
        body {
            background: linear-gradient(135deg, rgb(182 191 232) 0%, rgb(146 217 221) 100%);
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-color: var(--bg-color);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .container {
            position: relative;
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px); 
            max-width: 600px;
            width: 90%;
            padding: 2rem;
            padding-bottom: 10px;
            border-radius: 20px;
            box-shadow: 0 10px 20px rgba(0,0,0,0.05),
                        inset 0 0 0 1px rgba(255, 255, 255, 0.1);
            transition: transform 0.3s ease;
        }

        .container:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 30px rgba(0,0,0,0.1),
                        inset 0 0 0 1px rgba(255, 255, 255, 0.2);
        }
        
        h1 {
            text-align: center;
            color: var(--primary-color);
            margin-bottom: 2rem;
            font-size: 1.8rem;
        }
        
        .input-group {
            // margin-bottom: 1.5rem;
        }
        
        label {
            display: block;
            margin-bottom: 0.5rem;
            color: #555;
            font-weight: 500;
        }
        
        input, select, textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid rgba(0, 0, 0, 0.15);
            border-radius: 10px;
            font-size: 1rem;
            transition: all 0.3s ease;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.03);
        }

        input:focus, select:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.15),
                        inset 0 2px 4px rgba(0, 0, 0, 0.03);
        }
        
        textarea {
            min-height: 90px;
            resize: vertical;
            font-family: Consolas, Monaco, monospace;
            font-size: 0.9rem;
        }

        button {
            width: 100%;
            padding: 12px;
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            margin-bottom: 1.5rem;
        }
        
        button:hover {
            background-color: var(--hover-color);
            transform: translateY(-2px);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        #result {
            background-color: #f8f9fa;
            font-family: monospace;
            word-break: break-all;
            min-height: 40px;
        }

        .github-corner svg {
            fill: #b4c0e7;
            color: #2383ea;
            position: absolute;
            top: 0;
            right: 0;
            border: 0;
            width: 80px;
            height: 80px;
        }

        .github-corner:hover .octo-arm {
            animation: octocat-wave 560ms ease-in-out;
        }

        @keyframes octocat-wave {
            0%, 100% { transform: rotate(0) }
            20%, 60% { transform: rotate(-25deg) }
            40%, 80% { transform: rotate(10deg) }
        }

        @keyframes rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .logo-title {
            position: relative;
            display: flex;
            justify-content: center;
            align-items: center;
            margin-bottom: 2rem;
        }

        .logo-wrapper {
            position: absolute;
            left: 0;
            width: 50px;
            height: 50px;
        }

        .logo-title h1 {
            margin-bottom: 0;
            text-align: center;
        }

        @media (max-width: 768px) {
            .container {
                padding: 1rem;
                width: 100%;
            }
            
            h1 {
                font-size: 1.5rem;
            }

            .github-corner:hover .octo-arm {
                animation: none;
            }
            .github-corner .octo-arm {
                animation: octocat-wave 560ms ease-in-out;
            }

            .logo-wrapper {
                width: 40px;
                height: 40px;
            }
        }

        .beian-info {
            text-align: center;
            font-size: 13px;
        }

        .beian-info a {
            color: var(--primary-color);
            text-decoration: none;
            border-bottom: 1px dashed var(--primary-color);
            padding-bottom: 2px;
        }

        .beian-info a:hover {
            border-bottom-style: solid;
        }

        #qrcode {
            display: flex;
            justify-content: center;
            align-items: center;
            margin-top: 20px;
            min-height: 0;
            transition: min-height 0.3s ease;
        }
        
        #qrcode.show {
            min-height: 180px; /* Adjusted from 220px to 180px for 160x160 QR code */
        }

        .info-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background-color: var(--primary-color);
            color: white;
            font-size: 12px;
            margin-left: 8px;
            cursor: pointer;
            font-weight: bold;
            position: relative;
            top: -3px;
        }

        .info-tooltip {
            display: none;
            position: fixed;
            background: white;
            border: 1px solid var(--primary-color);
            border-radius: 8px;
            padding: 15px;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            min-width: 200px;
            max-width: 45vw;
            width: max-content;
            left: 50%;
            top: 70%;
            transform: translate(-50%, -50%);
            margin: 0;
            line-height: 1.6;
            font-size: 13px;
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }

        .info-tooltip::before {
            display: none;
        }
        
        .protocol-options {
            display: none;
            margin-top: 10px;
            padding: 10px;
            background-color: #f0f0f0;
            border-radius: 5px;
        }
        
        .protocol-options.show {
            display: block;
        }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head>
<body>
    <a href="https://github.com/eooce/Preferred-Sub-Generator" target="_blank" class="github-corner" aria-label="View source on Github">
        <svg viewBox="0 0 250 250" aria-hidden="true">
            <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path>
            <path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style="transform-origin: 130px 106px;" class="octo-arm"></path>
            <path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body"></path>
        </svg>
    </a>
    <div class="container">
        <div class="logo-title">
            <h1>优选订阅生成器</h1>
        </div>
        
        <div class="input-group">
            <label for="link">节点链接（每行一条，可粘贴多条）</label>
            <textarea id="link" rows="4" placeholder="每行一条，支持 vless://  vmess://  trojan://  ss://&#10;vless://uuid@host:443?...&#10;trojan://pass@host:443?..."></textarea>
        </div>
        
        <div class="input-group">
            <label for="ipList">优选 IP / 域名列表（每行一个，格式 IP:端口#备注）</label>
            <textarea id="ipList" rows="6" placeholder="104.16.4.14:443#HK&#10;saas.sin.fan:8443#HK"></textarea>
        </div>

        <div class="input-group">
            <label for="apiList">优选 API 源（每行一个链接，可留空）</label>
            <textarea id="apiList" rows="2" placeholder="https://example.com/bestip?port=443&id=HK"></textarea>
        </div>

        <div style="display: flex; gap: 10px; margin-bottom: 1rem;">
            <button onclick="saveIPList()" style="margin-bottom: 0;">保存列表</button>
            <button onclick="clearIPList()" style="background-color: #d83c3c; margin-bottom: 0;">清空列表</button>
        </div>
        <div id="saveStatus" style="font-size: 13px; text-align: center; color: #0dc690; margin-bottom: 10px;"></div>

        <button onclick="generateLink()">生成优选订阅</button>
        
        <div class="input-group">
            <div style="display: flex; align-items: center;">
                <label for="result">优选订阅</label>
                <div style="position: relative;">
                    <span class="info-icon" onclick="toggleTooltip(event)">!</span>
                    <div class="info-tooltip" id="infoTooltip">
                        <strong>Security Notice</strong>: When using the preferred subscription generator, you need to submit <strong>node configuration information</strong> to generate preferred subscription links.<br><br>
                        Please use at your own risk.
                    </div>
                </div>
            </div>
            <input type="text" id="result" readonly onclick="copyToClipboard()">
            <div style="display: flex; gap: 10px; margin-top: 10px;">
                <button onclick="generateQRCode()" style="flex: 1;">点击生成二维码</button>
                <button onclick="cleardata()" style="background-color: #d83c3c;flex: 1;">清除输入</button>
            </div>
            <div id="qrcode" style="margin: 1px;"></div>
        </div>
        <div class="beian-info" style="text-align: center; font-size: 13px;">
            <a href="https://t.me/eooceu" target="_blank">老王技术交流分享群</a>
        </div>
    </div>

    <script>
        const KV_ENABLED = __KV_ENABLED__;

        // 与后端一致的 UTF-8 -> Base64
        function utf8ToBase64(str) {
            return btoa(unescape(encodeURIComponent(str)));
        }

        // 页面加载时回填已保存的列表
        window.addEventListener('DOMContentLoaded', async function() {
            const ipEl = document.getElementById('ipList');
            const apiEl = document.getElementById('apiList');
            ipEl.value = localStorage.getItem('cfips') || '';
            apiEl.value = localStorage.getItem('cfips_api') || '';
            if (KV_ENABLED) {
                try {
                    const r = await fetch('/config');
                    const d = await r.json();
                    if (d.cfips !== undefined && d.cfips) ipEl.value = d.cfips;
                    if (d.cfips_api !== undefined && d.cfips_api) apiEl.value = d.cfips_api;
                } catch (e) { console.error(e); }
            }
        });

        function showStatus(msg, ok) {
            const el = document.getElementById('saveStatus');
            el.textContent = msg;
            el.style.color = (ok === false) ? '#d83c3c' : '#0dc690';
            setTimeout(function() { el.textContent = ''; }, 3000);
        }

        function clearIPList() {
            document.getElementById('ipList').value = '';
            document.getElementById('apiList').value = '';
            localStorage.removeItem('cfips');
            localStorage.removeItem('cfips_api');
            showStatus('已清空（云端需再点一次保存）');
        }

        async function saveIPList() {
            const ips = document.getElementById('ipList').value.trim();
            const api = document.getElementById('apiList').value.trim();
            localStorage.setItem('cfips', ips);
            localStorage.setItem('cfips_api', api);
            if (!KV_ENABLED) {
                showStatus('已保存在本浏览器（未绑定 KV）');
                return;
            }
            try {
                const r = await fetch('/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cfips: ips, cfips_api: api })
                });
                const d = await r.json();
                showStatus(d.success ? '已保存到云端' : ('保存失败：' + (d.error || '')), d.success);
            } catch (e) {
                showStatus('保存失败：' + e, false);
            }
        }

        function toggleTooltip(event) {
            event.stopPropagation();
            const tooltip = document.getElementById('infoTooltip');
            tooltip.style.display = tooltip.style.display === 'block' ? 'none' : 'block';
        }
        
        // Click outside to close tooltip
        document.addEventListener('click', function(event) {
            const tooltip = document.getElementById('infoTooltip');
            const infoIcon = document.querySelector('.info-icon');
            
            if (!tooltip.contains(event.target) && !infoIcon.contains(event.target)) {
                tooltip.style.display = 'none';
            }
        });

        function copyToClipboard() {
            const resultInput = document.getElementById('result');
            if (!resultInput.value) {
                return;
            }
            
            resultInput.select();
            navigator.clipboard.writeText(resultInput.value).then(() => {
                const tooltip = document.createElement('div');
                tooltip.style.position = 'fixed';
                tooltip.style.left = '50%';
                tooltip.style.top = '20px';
                tooltip.style.transform = 'translateX(-50%)';
                tooltip.style.padding = '8px 16px';
                tooltip.style.background = '#0dc690';
                tooltip.style.color = 'white';
                tooltip.style.borderRadius = '4px';
                tooltip.style.zIndex = '1000';
                tooltip.textContent = '链接复制成功';
                
                document.body.appendChild(tooltip);
                
                setTimeout(() => {
                    document.body.removeChild(tooltip);
                }, 2000);
            }).catch(err => {
                alert('Copy failed, please copy manually');
            });
        }

        async function generateLink() {
            const link = document.getElementById('link').value;
            if (!link) {
                alert('Please enter node link');
                return;
            }

            const ips = document.getElementById('ipList').value.trim();
            const api = document.getElementById('apiList').value.trim();

            // 绑定了 KV：先把列表存到云端，订阅链接保持简短
            if (KV_ENABLED) {
                localStorage.setItem('cfips', ips);
                localStorage.setItem('cfips_api', api);
                try {
                    await fetch('/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cfips: ips, cfips_api: api })
                    });
                } catch (e) { console.error(e); }
            }

            let subLink = '';
            let shortNote = '';
            try {
                // For all link types, pass the entire link to the backend
                const domain = window.location.hostname;
                subLink = 'https://' + domain + '/sub?link=' + encodeURIComponent(link);

                // 未绑定 KV 时，把列表随链接一起传给后端
                if (!KV_ENABLED) {
                    if (ips) subLink += '&ips=' + encodeURIComponent(utf8ToBase64(ips));
                    if (api) subLink += '&api=' + encodeURIComponent(utf8ToBase64(api));
                }

                // 绑定了 KV：再把节点链接换成短链（订阅内容仍实时读 KV 里的优选列表）
                if (KV_ENABLED) {
                    try {
                        const sr = await fetch('/shorten', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ link: link })
                        });
                        const sd = await sr.json();
                        if (sd && sd.success && sd.short) {
                            subLink = sd.short;
                        } else {
                            shortNote = '短链生成失败（' + ((sd && sd.error) || '未知错误') + '），已退回长链接';
                        }
                    } catch (e) {
                        console.error(e);
                        shortNote = '短链生成失败，已退回长链接';
                    }
                }
                document.getElementById('result').value = subLink;
                
                // Hide QR code container until user clicks "Generate QR Code"
                const qrcodeDiv = document.getElementById('qrcode');
                qrcodeDiv.classList.remove('show');
                qrcodeDiv.innerHTML = '';
            } catch (error) {
                alert('Error generating link, please check input');
                return;
            }

            // 生成后自检：显示节点数量、被跳过的行
            try {
                const checkResp = await fetch(subLink);
                const skipped = checkResp.headers.get('X-Skipped-Lines') || '';
                const nodeCount = checkResp.headers.get('X-Node-Count') || '';
                const rawText = await checkResp.text();
                let info = '';
                if (nodeCount) {
                    info = '已生成 ' + nodeCount + ' 个节点';
                } else {
                    info = rawText.slice(0, 60);
                }
                if (skipped) {
                    info += '；第 ' + skipped + ' 行链接无法解析，已跳过';
                }
                if (shortNote) {
                    info = shortNote + '（' + info + '）';
                    showStatus(info, false);
                } else {
                    showStatus(info, !skipped);
                }
            } catch (e) {
                console.error(e);
            }
        }
        
        function generateQRCode() {
            const subLink = document.getElementById('result').value;
            if (!subLink) {
                alert('Please generate subscription link first');
                return;
            }
            
            // Show and update QR code
            const qrcodeDiv = document.getElementById('qrcode');
            qrcodeDiv.innerHTML = '';
            qrcodeDiv.classList.add('show');
            
            // Use the new QRCode library with custom size and color
            new QRCode(qrcodeDiv, {
                text: subLink,
                width: 160,
                height: 160,
                colorDark: "black",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        }
        // Clear input fields
        function cleardata() {
            document.getElementById('link').value = '';
            document.getElementById('result').value = '';
            const qrcodeDiv = document.getElementById('qrcode');
            qrcodeDiv.innerHTML = '';
            qrcodeDiv.classList.remove('show');
        }
    </script>
</body>
</html>
`;

// 生成 n 位随机短链 key（去掉 I/l/o/O/0/1 等易混字符）
function randomKey(n) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < n; i++) {
        out += chars[bytes[i] % chars.length];
    }
    return out;
}

// Main handler function
export default {
    async fetch(request, env) {
        let url = new URL(request.url);

        // ===== 短链：/s/<key> 内部改写成 /sub?link=<KV 里存的链接> =====
        // 只存「节点链接」，优选 IP 列表仍实时读 KV → 换 IP 不用改短链
        if (url.pathname.startsWith('/s/')) {
            const shortKey = url.pathname.slice(3).replace(/\/+$/, '');
            const kvShort = env && env[KV_NAME];
            if (!kvShort) {
                return new Response('短链不可用：未绑定 KV（SUB_KV）', {
                    status: 500,
                    headers: { 'content-type': 'text/plain; charset=utf-8' },
                });
            }
            let storedLinks = null;
            try {
                storedLinks = await kvShort.get('short:' + shortKey);
            } catch (e) {
                console.error('KV read error:', e);
            }
            if (!storedLinks) {
                return new Response('短链不存在或已失效', {
                    status: 404,
                    headers: { 'content-type': 'text/plain; charset=utf-8' },
                });
            }
            url = new URL(url.origin + '/sub?link=' + encodeURIComponent(storedLinks));
        }

        // Return frontend page for root path
        if (url.pathname === '/') {
            const html = frontendHtml.replace('__KV_ENABLED__', (env && env[KV_NAME]) ? 'true' : 'false');
            return new Response(html, {
                headers: {
                    "content-type": "text/html; charset=utf-8",
                },
            });
        }
        
        // Handle /sub path as well as root path for API requests
        if (url.pathname !== '/' && url.pathname !== '/sub' && url.pathname !== '/config' && url.pathname !== '/shorten') {
            return new Response('Not Found', {
                status: 404,
                headers: {
                    "content-type": "text/plain; charset=utf-8",
                },
            });
        }
        
        // Return CORS headers for OPTIONS requests
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                }
            });
        }

        // ===== 生成短链：把节点链接存进 KV，返回 /s/<key> =====
        if (url.pathname === '/shorten') {
            const kvShort = env && env[KV_NAME];
            const jsonHeaders = {
                'content-type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            };
            if (!kvShort) {
                return new Response(JSON.stringify({ success: false, error: '未绑定 KV（SUB_KV）' }), { headers: jsonHeaders });
            }

            let linksText = url.searchParams.get('link') || '';
            if (request.method === 'POST') {
                try {
                    const body = await request.json();
                    if (body && body.link) linksText = String(body.link);
                } catch (e) { /* 空 body 时走 query 参数 */ }
            }
            linksText = linksText.trim();
            if (!linksText) {
                return new Response(JSON.stringify({ success: false, error: '缺少 link 参数' }), { headers: jsonHeaders });
            }

            let shortKey = '';
            for (let i = 0; i < 5; i++) {
                const candidate = randomKey(8);
                const exists = await kvShort.get('short:' + candidate);
                if (!exists) {
                    shortKey = candidate;
                    break;
                }
            }
            if (!shortKey) {
                return new Response(JSON.stringify({ success: false, error: '生成短 key 失败，请重试' }), { headers: jsonHeaders });
            }

            try {
                await kvShort.put('short:' + shortKey, linksText);
            } catch (e) {
                return new Response(JSON.stringify({ success: false, error: String(e) }), { headers: jsonHeaders });
            }

            return new Response(JSON.stringify({
                success: true,
                key: shortKey,
                short: url.origin + '/s/' + shortKey
            }), { headers: jsonHeaders });
        }

        // ===== 网页上填写的优选列表：读取 / 保存 =====
        if (url.pathname === '/config') {
            const kv = env && env[KV_NAME];
            const jsonHeaders = {
                'content-type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            };

            if (request.method === 'GET') {
                let cfipsText = '';
                let apiText = '';
                if (kv) {
                    try {
                        cfipsText = (await kv.get('cfips')) || '';
                        apiText = (await kv.get('cfips_api')) || '';
                    } catch (e) {
                        console.error('KV read error:', e);
                    }
                }
                return new Response(JSON.stringify({ cfips: cfipsText, cfips_api: apiText, kv: !!kv }), {
                    headers: jsonHeaders
                });
            }

            if (request.method === 'POST') {
                if (!kv) {
                    return new Response(JSON.stringify({ success: false, error: '未绑定 KV（SUB_KV）' }), {
                        headers: jsonHeaders
                    });
                }
                try {
                    const body = await request.json();
                    await kv.put('cfips', String(body.cfips || ''));
                    await kv.put('cfips_api', String(body.cfips_api || ''));
                    return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
                } catch (e) {
                    return new Response(JSON.stringify({ success: false, error: String(e) }), {
                        headers: jsonHeaders
                    });
                }
            }

            return new Response('Method Not Allowed', { status: 405 });
        }
        
        let host = "";
        let uuid = "";
        let path = "";
        let sni = "";
        let type = "ws";
        let protocolType = 'VLESS'; 
        let security = 'tls';
        let encryption = 'none';
        let transportLayerProtocol = 'tcp';
        
        // Extract information from query parameters
        host = url.searchParams.get('host') || "";
        uuid = url.searchParams.get('uuid') || url.searchParams.get('password') || url.searchParams.get('pw') || "";
        path = url.searchParams.get('path') || "/?ed=2560";
        sni = url.searchParams.get('sni') || host;
        type = url.searchParams.get('type') || type;
        security = url.searchParams.get('security') || security;
        encryption = url.searchParams.get('encryption') || encryption;
        transportLayerProtocol = url.searchParams.get('headerType') || transportLayerProtocol;
        
        // Check protocol type parameter
        const protocolParam = url.searchParams.get('protocol');
        if (protocolParam) {
            if (protocolParam === 'vmess') {
                protocolType = 'VMess';
            } else if (protocolParam === 'trojan') {
                protocolType = 'Trojan';
            } else if (protocolParam === 'ss') {
                protocolType = 'SS';
            } else {
                protocolType = protocolParam.toUpperCase();
            }
        }
        
        // Check if it's a Shadowsocks link
        if (url.searchParams.has('plugin') && url.searchParams.get('plugin').includes('v2ray-plugin')) {
            protocolType = 'SS';
            // Extract host and path from plugin parameter
            const pluginParam = url.searchParams.get('plugin');
            if (pluginParam) {
                // Extract host
                const hostMatch = pluginParam.match(/host%3D([^;]+)/);
                if (hostMatch) {
                    host = decodeURIComponent(hostMatch[1]);
                }
                // Extract path
                const pathMatch = pluginParam.match(/path%3D([^;]+)/);
                if (pathMatch) {
                    path = decodeURIComponent(pathMatch[1]);
                }
            }
            
            // Check if uuid parameter is Base64 encoded "method:password" format
            const uuidParam = url.searchParams.get('uuid');
            if (uuidParam) {
                try {
                    const decodedUuid = atob(uuidParam);
                    if (decodedUuid.includes(':')) {
                        const [method, password] = decodedUuid.split(':');
                        encryption = method || 'none';
                        uuid = password || uuid;
                    }
                } catch (e) {
                    console.log('uuid parameter is not Base64 encoded');
                }
            }
        }
        
        // Check if it's an XHTTP link
        let mode = ""; // Add mode variable for XHTTP
        if (url.searchParams.has('type') && url.searchParams.get('type') === 'xhttp' && url.searchParams.has('security') && url.searchParams.get('security') === 'tls') {
            protocolType = 'XHTTP';
            mode = url.searchParams.get('mode') || "packet-up"; 
        }
        
        // ===== 收集所有输入的节点链接（支持多行 / 多个 link 参数）=====
        const rawLinkParams = url.searchParams.getAll('link');
        const linkList = [];
        for (const raw of rawLinkParams) {
            for (const line of String(raw).split(/\r?\n/)) {
                const oneLine = line.trim();
                if (oneLine && !oneLine.startsWith('//') && !oneLine.startsWith('#')) {
                    linkList.push(oneLine);
                }
            }
        }

        // ===== 解析出所有节点参数 =====
        const nodeParamsList = [];
        const skippedLines = [];

        if (host && uuid) {
            // 直接参数模式（老用法）：?host=xxx&uuid=xxx&...
            nodeParamsList.push({ host, uuid, path, sni, type, protocolType, security, encryption, mode, remark: '', ssPluginParam: '' });
        } else if (linkList.length > 0) {
            for (let i = 0; i < linkList.length; i++) {
                try {
                    nodeParamsList.push(parseNodeLink(linkList[i], url));
                } catch (e) {
                    console.error('Error parsing link:', e);
                    skippedLines.push(i + 1);
                }
            }
            if (nodeParamsList.length === 0) {
                const responseText = `
Error parsing link. Please check the link format.

Supported link formats:
- VLESS: vless://uuid@host:port?...
- VMess: vmess://base64encoded_json
- Trojan: trojan://password@host:port?...
- Shadowsocks: ss://base64(method:password)@host:port?...
                `;

                return new Response(responseText, {
                    status: 400,
                    headers: { 'content-type': 'text/plain; charset=utf-8' },
                });
            }
            if (skippedLines.length > 0) {
                console.log('无法解析的链接行:', skippedLines.join(','));
            }
        } else {
            const responseText = `
Missing required parameters: host and uuid

Example link:
${url.origin}/sub?host=example.com&uuid=your-uuid&path=/your-path

Or provide node link(s), one per line:
${url.origin}/sub?link=your_node_link_here

Supported protocols:
- VLESS WebSocket TLS: vless-ws-tls
- VLESS XHTTP TLS: vless-xhttp-tls
- VMess WebSocket TLS: vmess-ws-tls
- Trojan WebSocket TLS: trojan-ws-tls
- Shadowsocks WebSocket TLS: ss-ws-tls
            `;

            return new Response(responseText, {
                status: 202,
                headers: { 'content-type': 'text/plain; charset=utf-8' },
            });
        }

        // 取生效的地址列表：链接参数 > KV > 代码默认值
        const addressConfig = await getAddressConfig(url, env);

        let allAddresses = [...addressConfig.ips];

        // Add addresses from cfips_api if it's not empty
        if (addressConfig.api && addressConfig.api.length > 0) {
            try {
                const apiAddresses = await organizeCFIPList(addressConfig.api);
                // Add valid addresses to allAddresses
                allAddresses = [...allAddresses, ...apiAddresses];
            } catch (error) {
                console.error('Error processing cfips_api:', error);
            }
        }
        
        // ===== 生成节点：每条链接 × 每个优选地址 =====
        const nodeLinks = [];

        for (const np of nodeParamsList) {
            for (const addressInfo of allAddresses) {
                const oneNodeLink = buildNodeLink(np, addressInfo, url);
                if (oneNodeLink) {
                    nodeLinks.push(oneNodeLink);
                }
            }
        } 
            
        // 列表为空时给友好提示
        if (allAddresses.length === 0) {
            return new Response('还没有可用的优选地址：请先在网页上填写「优选 IP 列表」并点保存。', {
                status: 200,
                headers: { 'content-type': 'text/plain; charset=utf-8' },
            });
        }

        // Check if there are valid node links
        if (nodeLinks.length === 0) {
            return new Response('Failed to generate any valid node links', {
                status: 500,
                headers: { 'content-type': 'text/plain; charset=utf-8' },
            });
        }
        
        // Join all links with newlines
        const allLinks = nodeLinks.join('\n');
        
        // Base64 encode
        let base64Links;
        try {
            base64Links = btoa(allLinks);
        } catch (error) {
            console.error('Error during Base64 encoding:', error);
            return new Response('Base64 encoding failed', {
                status: 500,
                headers: { 'content-type': 'text/plain; charset=utf-8' },
            });
        }
        
        // Return response
        return new Response(base64Links, {
            headers: {
                "content-type": "text/plain; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Expose-Headers": "X-Skipped-Lines, X-Node-Count",
                "X-Skipped-Lines": skippedLines.join(','),
                "X-Node-Count": String(nodeLinks.length),
            },
        });
    }
};

