//#region src/plugins/captcha/constants.ts
/**
* Upper bound (in milliseconds) for a single provider verification request.
* Without it, a hanging provider would tie up the request indefinitely before
* any rate limiting applies, so every verify handler aborts at this deadline
* and fails closed.
*/
const CAPTCHA_VERIFY_TIMEOUT_MS = 1e4;
const defaultEndpoints = [
	"/sign-up/email",
	"/sign-in/email",
	"/request-password-reset"
];
const Providers = {
	CLOUDFLARE_TURNSTILE: "cloudflare-turnstile",
	GOOGLE_RECAPTCHA: "google-recaptcha",
	HCAPTCHA: "hcaptcha",
	CAPTCHAFOX: "captchafox"
};
const siteVerifyMap = {
	[Providers.CLOUDFLARE_TURNSTILE]: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
	[Providers.GOOGLE_RECAPTCHA]: "https://www.google.com/recaptcha/api/siteverify",
	[Providers.HCAPTCHA]: "https://api.hcaptcha.com/siteverify",
	[Providers.CAPTCHAFOX]: "https://api.captchafox.com/siteverify"
};
//#endregion
export { CAPTCHA_VERIFY_TIMEOUT_MS, Providers, defaultEndpoints, siteVerifyMap };
