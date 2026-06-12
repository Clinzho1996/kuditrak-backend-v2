import Budget from "../models/Budget.js";
import SavingsBucket from "../models/SavingsBucket.js";
import Transaction from "../models/Transaction.js";
import Wallet from "../models/Wallet.js";

export const generateFinancialInsights = async (userId) => {
	const now = new Date();

	const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

	// Wallet
	const wallet = await Wallet.findOne({ userId });
	const balance = wallet?.balance || 0;

	// Transactions
	const transactions = await Transaction.find({ userId });

	let totalSpent = 0;

	transactions.forEach((t) => {
		if (t.type === "expense") totalSpent += t.amount;
	});

	/*
	|--------------------------------------------------------------------------
	| Monthly Spending Comparison
	|--------------------------------------------------------------------------
	*/

	const thisMonthSpent = transactions
		.filter((t) => t.type === "expense" && t.createdAt >= startOfThisMonth)
		.reduce((sum, t) => sum + t.amount, 0);

	const lastMonthSpent = transactions
		.filter(
			(t) =>
				t.type === "expense" &&
				t.createdAt >= startOfLastMonth &&
				t.createdAt <= endOfLastMonth,
		)
		.reduce((sum, t) => sum + t.amount, 0);

	const spendingChange =
		lastMonthSpent === 0
			? 0
			: ((thisMonthSpent - lastMonthSpent) / lastMonthSpent) * 100;

	/*
	|--------------------------------------------------------------------------
	| Savings Comparison
	|--------------------------------------------------------------------------
	*/

	const buckets = await SavingsBucket.find({ userId });

	const totalSaved = buckets.reduce((sum, b) => sum + b.currentAmount, 0);

	const lastMonthSavings = buckets.reduce(
		(sum, b) => sum + (b.lastMonthAmount || 0),
		0,
	);

	const savingsChange =
		lastMonthSavings === 0
			? 0
			: ((totalSaved - lastMonthSavings) / lastMonthSavings) * 100;

	/*
	|--------------------------------------------------------------------------
	| Budget Insights
	|--------------------------------------------------------------------------
	*/

	const budgets = await Budget.find({ userId });

	const budgetInsights = [];

	for (const budget of budgets) {
		const spent = transactions
			.filter(
				(t) =>
					t.budgetId?.toString() === budget._id.toString() &&
					t.type === "expense" &&
					t.createdAt >= startOfThisMonth,
			)
			.reduce((sum, t) => sum + t.amount, 0);

		budgetInsights.push({
			budgetName: budget.name,
			budgetAmount: budget.amount,
			spent,
			remaining: budget.amount - spent,
			percentageUsed: (spent / budget.amount) * 100,
		});
	}

	/*
	|--------------------------------------------------------------------------
	| Suggestions Engine
	|--------------------------------------------------------------------------
	*/

	const suggestions = [];

	if (spendingChange > 20) {
		suggestions.push("Your spending increased significantly this month");
	}

	if (savingsChange < 0) {
		suggestions.push("You saved less than last month");
	}

	if (budgetInsights.some((b) => b.percentageUsed > 90)) {
		suggestions.push("You are close to exceeding a budget");
	}

	if (suggestions.length === 0) {
		suggestions.push("Your finances are stable this month");
	}

	return {
		balance,
		available: balance - totalSpent,
		totalSpent,
		totalSaved,

		monthlyComparison: {
			thisMonthSpent,
			lastMonthSpent,
			spendingChangePercentage: spendingChange,
		},

		savingsComparison: {
			thisMonthSavings: totalSaved,
			lastMonthSavings,
			savingsChangePercentage: savingsChange,
		},

		budgets: budgetInsights,

		suggestions,
	};
};
