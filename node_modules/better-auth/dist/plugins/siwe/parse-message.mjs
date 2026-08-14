//#region src/plugins/siwe/parse-message.ts
const HEADER_REGEX = /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):\/\/)?(\S+) wants you to sign in with your Ethereum account:$/;
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const FIELD_REGEX = /^([A-Za-z ]+): (.*)$/;
function parseSiweMessage(message) {
	const result = {};
	const lines = message.split(/\r?\n/);
	const headerMatch = lines[0]?.match(HEADER_REGEX);
	if (headerMatch) {
		if (headerMatch[1]) result.scheme = headerMatch[1];
		result.domain = headerMatch[2];
	}
	const addressLine = lines[1]?.trim();
	if (addressLine && ADDRESS_REGEX.test(addressLine)) result.address = addressLine;
	for (const line of lines) {
		const match = line.match(FIELD_REGEX);
		if (!match) continue;
		const [, key, value] = match;
		switch (key) {
			case "URI":
				result.uri = value;
				break;
			case "Version":
				result.version = value;
				break;
			case "Chain ID": {
				const parsed = Number(value);
				if (Number.isInteger(parsed)) result.chainId = parsed;
				break;
			}
			case "Nonce":
				result.nonce = value;
				break;
			case "Issued At":
				result.issuedAt = value;
				break;
			case "Expiration Time":
				result.expirationTime = value;
				break;
			case "Not Before":
				result.notBefore = value;
				break;
			case "Request ID":
				result.requestId = value;
				break;
		}
	}
	return result;
}
/**
* Normalizes a SIWE `domain` (RFC 3986 authority) for comparison: strips any
* scheme and path, lowercases, leaving `host[:port]`.
*/
function normalizeSiweDomain(domain) {
	const withoutScheme = domain.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
	const pathStart = withoutScheme.indexOf("/");
	return pathStart === -1 ? withoutScheme : withoutScheme.slice(0, pathStart);
}
//#endregion
export { normalizeSiweDomain, parseSiweMessage };
