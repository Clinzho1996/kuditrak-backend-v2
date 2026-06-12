import Budget from "../models/Budget.js";
import Transaction from "../models/Transaction.js";
import { sendPush } from "./pushService.js";

export const calculateUserInsights = async (userId, sendAlerts = false) => {
	const transactions = await Transaction.find({ userId });

	const totalIncome = transactions
		.filter((t) => t.type === "income")
		.reduce((acc, t) => acc + t.amount, 0);

	const totalExpenses = transactions
		.filter((t) => t.type === "expense")
		.reduce((acc, t) => acc + t.amount, 0);

	// Budgets
	const budgets = await Budget.find({ userId });
	const budgetUsage = budgets.map((b) => {
		const spent = transactions
			.filter(
				(t) =>
					t.type === "expense" &&
					t.categoryName?.toLowerCase() === b.name.toLowerCase(),
			)
			.reduce((acc, t) => acc + t.amount, 0);

		return {
			budgetId: b._id,
			budgetName: b.name,
			budgetAmount: b.amount,
			spent,
			remaining: b.amount - spent,
			percentageUsed: b.amount ? Math.min((spent / b.amount) * 100, 100) : 0,
		};
	});

	if (sendAlerts) {
		for (const b of budgetUsage) {
			if (b.percentageUsed >= 90) {
				await sendPush(
					(await User.findById(userId)).pushToken,
					`⚠️ Budget Alert: You have used ${b.percentageUsed.toFixed(0)}% of your ${b.budgetName} budget!`,
				);
			}
		}
	}

	return {
		totalIncome,
		totalExpenses,
		netBalance: totalIncome - totalExpenses,
		budgets: budgetUsage,
	};
};

// Push alerts for budgets over 90%
export const pushBudgetAlerts = async (user) => {
	const insights = await calculateUserInsights(user._id);

	for (const b of insights.budgetUsage) {
		if (b.percentageUsed >= 90) {
			await sendPush(
				user.pushToken,
				`⚠️ Budget Alert: You have used ${b.percentageUsed.toFixed(
					0,
				)}% of your ${b.budgetName} budget!`,
			);
		}
	}
};
