"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_FAVICON_ALLOWED_MIME_TYPES = exports.APP_FAVICON_MAX_BYTES = exports.APP_LOGO_ALLOWED_MIME_TYPES = exports.APP_LOGO_MAX_BYTES = exports.CONSENT_DOCUMENT_TYPES = exports.TokenErrorCode = void 0;
exports.detectIdentifierType = detectIdentifierType;
exports.evaluatePasswordPolicy = evaluatePasswordPolicy;
exports.isValidAppLogoDataUri = isValidAppLogoDataUri;
exports.isValidAppFaviconDataUri = isValidAppFaviconDataUri;
exports.renderTemplate = renderTemplate;
exports.getBetterAuthCookieName = getBetterAuthCookieName;
/** Machine-readable codes returned as the `error` field in 4xx JWT responses. */
var TokenErrorCode;
(function (TokenErrorCode) {
    TokenErrorCode["USER_ORG_MISMATCH"] = "USER_ORG_MISMATCH";
    TokenErrorCode["APP_NOT_FOUND"] = "APP_NOT_FOUND";
    TokenErrorCode["USER_NOT_FOUND"] = "USER_NOT_FOUND";
    TokenErrorCode["INVALID_CREDENTIALS"] = "INVALID_CREDENTIALS";
    TokenErrorCode["INVALID_REQUEST"] = "invalid_request";
    TokenErrorCode["INVALID_REDIRECT_URI"] = "invalid_redirect_uri";
    TokenErrorCode["INVALID_GRANT"] = "invalid_grant";
    TokenErrorCode["INVALID_CLIENT"] = "invalid_client";
    TokenErrorCode["UNAUTHORIZED_CLIENT"] = "unauthorized_client";
    TokenErrorCode["TWO_FACTOR_REQUIRED"] = "TWO_FACTOR_REQUIRED";
})(TokenErrorCode || (exports.TokenErrorCode = TokenErrorCode = {}));
/** Detects the type of a login identifier string. */
function detectIdentifierType(identifier) {
    if (identifier.includes('@'))
        return 'email';
    if (/^\+?[\d\s\-().]{7,}$/.test(identifier))
        return 'phone';
    return 'username';
}
exports.CONSENT_DOCUMENT_TYPES = [
    'privacy_policy',
    'terms',
    'gdpr',
];
const SPECIAL_CHAR_PATTERN = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/g;
function countMatches(password, pattern) {
    return (password.match(pattern) ?? []).length;
}
/**
 * Pure, dependency-free. Evaluates every rule (does not short-circuit) so
 * callers can report or render every failure, not just the first one hit.
 */
function evaluatePasswordPolicy(password, policy) {
    const numberCount = countMatches(password, /[0-9]/g);
    const specialCount = countMatches(password, SPECIAL_CHAR_PATTERN);
    const results = [
        { rule: 'minLength', met: password.length >= policy.minLength },
    ];
    if (policy.requireUppercase) {
        results.push({ rule: 'requireUppercase', met: /[A-Z]/.test(password) });
    }
    if (policy.requireLowercase) {
        results.push({ rule: 'requireLowercase', met: /[a-z]/.test(password) });
    }
    if (policy.requireNumber) {
        results.push({ rule: 'requireNumber', met: numberCount >= 1 });
        if (policy.minNumbers > 1) {
            results.push({ rule: 'minNumbers', met: numberCount >= policy.minNumbers });
        }
    }
    if (policy.requireSpecial) {
        results.push({ rule: 'requireSpecial', met: specialCount >= 1 });
        if (policy.minSpecial > 1) {
            results.push({ rule: 'minSpecial', met: specialCount >= policy.minSpecial });
        }
    }
    return results;
}
exports.APP_LOGO_MAX_BYTES = 250 * 1024;
exports.APP_LOGO_ALLOWED_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
];
exports.APP_FAVICON_MAX_BYTES = exports.APP_LOGO_MAX_BYTES;
exports.APP_FAVICON_ALLOWED_MIME_TYPES = exports.APP_LOGO_ALLOWED_MIME_TYPES;
function buildImageDataUriPattern(allowedTypes) {
    return new RegExp(`^data:(${allowedTypes.map((t) => t.replace('/', '\\/').replace('+', '\\+')).join('|')});base64,([A-Za-z0-9+/]+=?=?)$`);
}
/**
 * True when `value` is a data URI whose mime type is in `allowedTypes` and
 * whose decoded byte size is within `maxBytes`. Shared by
 * isValidAppLogoDataUri and isValidAppFaviconDataUri so the two rules
 * (currently identical) can't silently drift apart from independently
 * duplicated regex/byte-math.
 */
function isValidImageDataUri(value, allowedTypes, maxBytes) {
    if (typeof value !== 'string')
        return false;
    const match = buildImageDataUriPattern(allowedTypes).exec(value);
    if (!match)
        return false;
    const base64Payload = match[2];
    const padding = base64Payload.endsWith('==') ? 2 : base64Payload.endsWith('=') ? 1 : 0;
    const decodedBytes = (base64Payload.length * 3) / 4 - padding;
    return decodedBytes <= maxBytes;
}
/**
 * True when `value` is a data URI of an allowed image type whose decoded
 * byte size is within APP_LOGO_MAX_BYTES. Used both by the admin console's
 * client-side file picker (before FileReader output is stored in state)
 * and by the auth-server's IsAppLogo class-validator decorator (before a
 * write hits the database) — one definition, two enforcement points.
 */
function isValidAppLogoDataUri(value) {
    return isValidImageDataUri(value, exports.APP_LOGO_ALLOWED_MIME_TYPES, exports.APP_LOGO_MAX_BYTES);
}
/**
 * Same rule as isValidAppLogoDataUri, exposed under its own name for the
 * favicon field (see IsAppFavicon / AppFaviconField). Deliberately reuses
 * APP_LOGO_ALLOWED_MIME_TYPES/APP_LOGO_MAX_BYTES as its source of truth
 * (via the APP_FAVICON_* aliases above) rather than an independent rule.
 */
function isValidAppFaviconDataUri(value) {
    return isValidImageDataUri(value, exports.APP_FAVICON_ALLOWED_MIME_TYPES, exports.APP_FAVICON_MAX_BYTES);
}
/**
 * Literal `{{token}}` substitution — no conditionals, no loops. A token not
 * present in `vars` is left in the output untouched, so a typo'd or removed
 * placeholder degrades visibly rather than silently vanishing.
 *
 * Does no output-context escaping — a caller substituting a value into HTML
 * (e.g. a user-supplied name) is responsible for escaping it first.
 */
function renderTemplate(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match);
}
function getBetterAuthCookieName(cookie, isProduction, prefix = 'better-auth') {
    const base = `${prefix}.${cookie}`;
    return isProduction ? `__Secure-${base}` : base;
}
