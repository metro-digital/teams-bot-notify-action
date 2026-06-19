/******/ /* webpack/runtime/compat */
/******/ 
/******/ if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = new URL('.', import.meta.url).pathname.slice(import.meta.url.match(/^file:\/\/\/\w:/) ? 1 : 0, -1) + "/";
/******/ 
/************************************************************************/
var __webpack_exports__ = {};

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 METRO.digital GmbH
/* global console */
function getInput(name, required = false) {
    const envName = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
    const fallbackEnvName = `INPUT_${name.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()}`;
    const value = (process.env[envName] ?? process.env[fallbackEnvName] ?? '').trim();
    if (required && !value) {
        throw new Error(`Input required and not supplied: ${name}`);
    }
    return value;
}
function info(message) {
    console.log(message);
}
function escapeWorkflowCommandValue(value) {
    return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function setFailed(message) {
    console.error(`::error::${escapeWorkflowCommandValue(message)}`);
    process.exitCode = 1;
}
async function fetchJson(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`);
    }
    return (await response.json());
}
async function run() {
    try {
        const tenantId = getInput('tenant-id', true);
        const clientId = getInput('client-id', true);
        const channelId = getInput('channel-id', true);
        const message = getInput('message', true);
        const oidcToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
        const oidcUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
        if (!oidcToken || !oidcUrl) {
            throw new Error('OIDC token or URL missing from environment.');
        }
        info('Getting Azure token...');
        const oidcResponse = await fetchJson(`${oidcUrl}&audience=api://AzureADTokenExchange`, {
            headers: { Authorization: `bearer ${oidcToken}` },
        });
        const githubToken = oidcResponse.value;
        const tokenResponse = await fetchJson(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_assertion: githubToken,
                client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
                grant_type: 'client_credentials',
                scope: 'https://api.botframework.com/.default',
            }),
        });
        const azureToken = tokenResponse.access_token;
        info('Azure token obtained');
        const response = await fetch('https://smba.trafficmanager.net/teams/v3/conversations', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${azureToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                isGroup: true,
                channelData: { channel: { id: channelId } },
                activity: { type: 'message', text: message },
            }),
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`);
        }
        info(`Message sent successfully! Status: ${response.status}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : `Unexpected error: ${String(error)}`;
        setFailed(message);
    }
}
run();

