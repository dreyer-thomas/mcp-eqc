// src/config.ts
export const EC_CLOUD_BASE_URL = process.env.EC_CLOUD_BASE_URL ?? "";
export const EC_USER = process.env.EC_USER ?? "";
export const EC_PASS = process.env.EC_PASS ?? "";
export const EC_LANG = process.env.EC_LANG ?? "de-de";
export function ensureConfig() {
    const missing = [];
    if (!EC_CLOUD_BASE_URL)
        missing.push("EC_CLOUD_BASE_URL");
    if (!EC_USER)
        missing.push("EC_USER");
    if (!EC_PASS)
        missing.push("EC_PASS");
    return missing;
}
export function buildBasicAuth() {
    if (!EC_USER || !EC_PASS)
        throw new Error("EC_USER/EC_PASS nicht gesetzt");
    return "Basic " + Buffer.from(`${EC_USER}:${EC_PASS}`, "utf8").toString("base64");
}
