require('dotenv').config();
const crypto = require('crypto');
const ORG_SECRET = process.env.SESSION_SECRET || 'bright_org_salt';

function encodeOrgId(id) {
    const hash = crypto.createHmac('sha256', ORG_SECRET).update(id.toString()).digest('hex').substring(0, 10);
    return `${id}-${hash}`;
}

console.log(`Hash for ID 1: ${encodeOrgId(1)}`);
console.log(`Hash for ID 3: ${encodeOrgId(3)}`);
