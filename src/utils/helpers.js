const crypto = require('crypto');

const ORG_SECRET = process.env.SESSION_SECRET || 'bright_org_salt';
const BETA_MODE = process.env.BETA_MODE === 'true';

/**
 * Obfuscates numeric organization ID
 */
function encodeOrgId(id) {
    const hash = crypto.createHmac('sha256', ORG_SECRET).update(id.toString()).digest('hex').substring(0, 10);
    return `${id}-${hash}`;
}

/**
 * Decodes obfuscated organization ID and verifies hash
 */
function decodeOrgId(obfuscatedId) {
    if (!obfuscatedId || typeof obfuscatedId !== 'string') return null;
    const parts = obfuscatedId.split('-');
    if (parts.length !== 2) return null;
    const [id, hash] = parts;
    const expectedHash = crypto.createHmac('sha256', ORG_SECRET).update(id).digest('hex').substring(0, 10);
    return hash === expectedHash ? parseInt(id) : null;
}

/**
 * Gets plan limits and status
 */
function getPlanDetails(req) {
    if (BETA_MODE) {
        return { plan: 'pro', limit: 1000, isBeta: true };
    }
    const plan = req.session.debug_plan || 'free';
    let limit = 1;
    if (plan === 'starter') limit = 5;
    if (plan === 'pro') limit = 1000;

    return { plan, limit, isBeta: false };
}

/**
 * Robust JSON Parser for AI Responses
 */
function robustJSONParse(str) {
    if (!str) return null;
    const jsonMatch = str.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    let cleanStr = jsonMatch[0];
    try {
        return JSON.parse(cleanStr);
    } catch (e) {
        try {
            cleanStr = cleanStr
                .replace(/\/\/.*$/gm, '') 
                .replace(/,(\s*[\]\}])/g, '$1')
                .trim();
            return JSON.parse(cleanStr);
        } catch (e2) {
            return null;
        }
    }
}

module.exports = {
    encodeOrgId,
    decodeOrgId,
    getPlanDetails,
    robustJSONParse
};
