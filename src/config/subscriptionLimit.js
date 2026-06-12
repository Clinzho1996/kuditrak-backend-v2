// config/subscriptionLimits.js
export const LIMITS = {
	free: {
		manualTransactions: 20,
		bankConnections: 1,
		budgets: 3,
		savingBuckets: 3,
	},
	basic: {
		manualTransactions: 25,
		bankConnections: 3,
		budgets: 10,
		savingBuckets: 10,
	},
	pro: {
		manualTransactions: Infinity,
		bankConnections: Infinity,
		budgets: Infinity,
		savingBuckets: Infinity,
	},
};
