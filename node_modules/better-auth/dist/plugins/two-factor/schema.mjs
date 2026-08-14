//#region src/plugins/two-factor/schema.ts
const schema = {
	user: { fields: { twoFactorEnabled: {
		type: "boolean",
		required: false,
		defaultValue: false,
		input: false
	} } },
	twoFactor: { fields: {
		secret: {
			type: "string",
			required: true,
			returned: false,
			index: true
		},
		backupCodes: {
			type: "string",
			required: true,
			returned: false
		},
		userId: {
			type: "string",
			required: true,
			returned: false,
			references: {
				model: "user",
				field: "id"
			},
			index: true
		},
		verified: {
			type: "boolean",
			required: false,
			defaultValue: true,
			input: false
		},
		failedVerificationCount: {
			type: "number",
			required: false,
			defaultValue: 0,
			input: false,
			returned: false
		},
		lockedUntil: {
			type: "date",
			required: false,
			input: false,
			returned: false
		}
	} }
};
//#endregion
export { schema };
