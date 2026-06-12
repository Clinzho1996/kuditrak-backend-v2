// backend/config/subscriptionPlans.js
export const PLANS = {
	// Apple / Google subscription product IDs
	monthly_basic: {
		id: "monthly_basic",
		name: "Basic Monthly",
		price: 1900,
		duration: "monthly",
		features: ["3 bank connections", "10 budgets", "50 manual transactions"],
	},
	monthly_pro: {
		id: "monthly_pro",
		name: "Pro Monthly",
		price: 3900,
		duration: "monthly",
		features: [
			"Unlimited bank connections",
			"Unlimited budgets",
			"Unlimited transactions",
			"Priority support",
		],
	},
	quarterly_pro: {
		id: "quarterly_pro",
		name: "Pro Quarterly",
		price: 9900,
		duration: "quarterly",
		features: [
			"Unlimited bank connections",
			"Unlimited budgets",
			"Unlimited transactions",
			"Priority support",
		],
	},
	yearly_pro: {
		id: "yearly_pro",
		name: "Pro Yearly",
		price: 36850,
		duration: "yearly",
		features: [
			"Unlimited bank connections",
			"Unlimited budgets",
			"Unlimited transactions",
			"Priority support",
			"Save 16%",
		],
	},
};
