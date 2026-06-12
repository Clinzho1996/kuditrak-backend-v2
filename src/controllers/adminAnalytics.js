// backend/controllers/analyticsController.js
import BankConnection from "../models/BankConnection.js";
import Budget from "../models/Budget.js";
import SavingsBucket from "../models/SavingsBucket.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";

// ===============================
// ADMIN - GET DASHBOARD ANALYTICS
// ===============================
export const getAdminDashboardAnalytics = async (req, res) => {
	try {
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

		// Get all users
		const totalUsers = await User.countDocuments();
		const activeUsers = await User.countDocuments({
			createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
		});

		// Get all transactions
		const allTransactions = await Transaction.find({});
		const currentMonthTransactions = await Transaction.find({
			createdAt: { $gte: startOfMonth },
		});

		const totalIncome = allTransactions
			.filter((t) => t.type === "income")
			.reduce((sum, t) => sum + t.amount, 0);

		const totalExpenses = allTransactions
			.filter((t) => t.type === "expense")
			.reduce((sum, t) => sum + t.amount, 0);

		const currentMonthIncome = currentMonthTransactions
			.filter((t) => t.type === "income")
			.reduce((sum, t) => sum + t.amount, 0);

		const currentMonthExpenses = currentMonthTransactions
			.filter((t) => t.type === "expense")
			.reduce((sum, t) => sum + t.amount, 0);

		// Budget and savings stats
		const totalBudgets = await Budget.countDocuments();
		const totalSavings = await SavingsBucket.countDocuments();
		const totalBankConnections = await BankConnection.countDocuments({
			status: "Active",
		});

		// User subscription breakdown
		const freeUsers = await User.countDocuments({
			"subscription.plan": "free",
		});
		const basicUsers = await User.countDocuments({
			"subscription.plan": "basic",
		});
		const proUsers = await User.countDocuments({ "subscription.plan": "pro" });

		// Top spending categories overall
		const categorySpending = allTransactions
			.filter((t) => t.type === "expense")
			.reduce((acc, t) => {
				const category = t.categoryName || "Other";
				acc[category] = (acc[category] || 0) + t.amount;
				return acc;
			}, {});

		const topCategories = Object.entries(categorySpending)
			.map(([name, amount]) => ({ name, amount }))
			.sort((a, b) => b.amount - a.amount)
			.slice(0, 5);

		const analyticsData = {
			users: {
				total: totalUsers,
				active: activeUsers,
				free: freeUsers,
				basic: basicUsers,
				pro: proUsers,
				conversionRate: totalUsers
					? (((basicUsers + proUsers) / totalUsers) * 100).toFixed(1)
					: 0,
			},
			transactions: {
				total: allTransactions.length,
				totalIncome,
				totalExpenses,
				netSavings: totalIncome - totalExpenses,
				currentMonth: {
					income: currentMonthIncome,
					expenses: currentMonthExpenses,
					count: currentMonthTransactions.length,
				},
			},
			engagement: {
				totalBudgets,
				totalSavings,
				totalBankConnections,
				avgBudgetsPerUser: totalUsers
					? (totalBudgets / totalUsers).toFixed(1)
					: 0,
				avgSavingsPerUser: totalUsers
					? (totalSavings / totalUsers).toFixed(1)
					: 0,
			},
			topCategories,
			revenue: {
				estimatedMrr: basicUsers * 1900 + proUsers * 3900,
				totalProcessed: totalIncome,
			},
		};

		res.json({
			success: true,
			data: analyticsData,
			timestamp: new Date(),
		});
	} catch (err) {
		console.error("Admin dashboard analytics error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// ADMIN - GET AI INSIGHTS
// ===============================
export const getAdminAIInsights = async (req, res) => {
	try {
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

		// Get all transactions
		const currentMonthTransactions = await Transaction.find({
			createdAt: { $gte: startOfMonth },
		});

		const lastMonthTransactions = await Transaction.find({
			createdAt: { $gte: startOfLastMonth, $lt: startOfMonth },
		});

		// Calculate overall metrics
		const currentSpending = currentMonthTransactions
			.filter((t) => t.type === "expense")
			.reduce((sum, t) => sum + t.amount, 0);

		const lastMonthSpending = lastMonthTransactions
			.filter((t) => t.type === "expense")
			.reduce((sum, t) => sum + t.amount, 0);

		const currentIncome = currentMonthTransactions
			.filter((t) => t.type === "income")
			.reduce((sum, t) => sum + t.amount, 0);

		const spendingChange =
			lastMonthSpending === 0
				? 0
				: ((currentSpending - lastMonthSpending) / lastMonthSpending) * 100;

		// Get top spending categories overall
		const categorySpending = currentMonthTransactions
			.filter((t) => t.type === "expense")
			.reduce((acc, t) => {
				const category = t.categoryName || "Other";
				acc[category] = (acc[category] || 0) + t.amount;
				return acc;
			}, {});

		const topCategories = Object.entries(categorySpending)
			.map(([name, amount]) => ({ name, amount }))
			.sort((a, b) => b.amount - a.amount)
			.slice(0, 3);

		// Generate global insights
		const insights = [];

		if (spendingChange > 10) {
			insights.push({
				type: "warning",
				title: "⚠️ Overall Spending Alert",
				message: `User spending is up ${Math.round(spendingChange)}% this month across all users.`,
			});
		} else if (spendingChange < -10) {
			insights.push({
				type: "success",
				title: "🎉 Great Overall Progress!",
				message: `User spending is down ${Math.abs(Math.round(spendingChange))}% this month.`,
			});
		}

		if (topCategories[0]) {
			insights.push({
				type: "info",
				title: "💰 Top Spending Category",
				message: `${topCategories[0].name} is the highest spending category this month.`,
			});
		}

		const savingsRate =
			currentIncome > 0
				? (((currentIncome - currentSpending) / currentIncome) * 100).toFixed(1)
				: 0;

		insights.push({
			type: "tip",
			title: "💡 Savings Insight",
			message: `Average savings rate is ${savingsRate}% this month.`,
			action: "View Reports",
		});

		const insightsData = {
			insights,
			summary: {
				totalSpent: currentSpending,
				totalIncome: currentIncome,
				avgSavingsRate: savingsRate,
				spendingChange: Math.round(spendingChange),
				topCategory: topCategories[0]?.name || null,
				totalUsers: await User.countDocuments(),
				activeUsers: await User.countDocuments({
					createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
				}),
			},
		};

		res.json({
			success: true,
			data: insightsData,
			timestamp: new Date(),
		});
	} catch (err) {
		console.error("Admin AI insights error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// ADMIN - GET MONTHLY TREND
// ===============================
export const getAdminMonthlyTrend = async (req, res) => {
	try {
		const { months = 6 } = req.query;

		const now = new Date();
		const trend = [];

		for (let i = 0; i < months; i++) {
			const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
			const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

			const transactions = await Transaction.find({
				createdAt: { $gte: startOfMonth, $lte: endOfMonth },
			});

			const income = transactions
				.filter((t) => t.type === "income")
				.reduce((sum, t) => sum + t.amount, 0);

			const expenses = transactions
				.filter((t) => t.type === "expense")
				.reduce((sum, t) => sum + t.amount, 0);

			trend.unshift({
				month: startOfMonth.toLocaleString("default", {
					month: "short",
					year: "numeric",
				}),
				income,
				expenses,
				savings: income - expenses,
				date: startOfMonth,
			});
		}

		const trendData = {
			trend,
			summary: {
				totalIncome: trend.reduce((sum, m) => sum + m.income, 0),
				totalExpenses: trend.reduce((sum, m) => sum + m.expenses, 0),
				totalSavings: trend.reduce((sum, m) => sum + m.savings, 0),
				bestMonth: trend.reduce(
					(best, m) => (m.savings > best.savings ? m : best),
					trend[0],
				),
				worstMonth: trend.reduce(
					(worst, m) => (m.savings < worst.savings ? m : worst),
					trend[0],
				),
			},
		};

		res.json({
			success: true,
			data: trendData,
			timestamp: new Date(),
		});
	} catch (err) {
		console.error("Admin monthly trend error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// ADMIN - GET SPENDING BY CATEGORY
// ===============================
export const getAdminSpendingByCategory = async (req, res) => {
	try {
		const { period = "month" } = req.query;

		let startDate;
		const now = new Date();

		switch (period) {
			case "week":
				startDate = new Date(now.setDate(now.getDate() - 7));
				break;
			case "month":
				startDate = new Date(now.getFullYear(), now.getMonth(), 1);
				break;
			case "year":
				startDate = new Date(now.getFullYear(), 0, 1);
				break;
			default:
				startDate = new Date(now.getFullYear(), now.getMonth(), 1);
		}

		const transactions = await Transaction.find({
			type: "expense",
			createdAt: { $gte: startDate },
		});

		const categorySpending = transactions.reduce((acc, t) => {
			const category = t.categoryName || "Other";
			acc[category] = (acc[category] || 0) + t.amount;
			return acc;
		}, {});

		const data = Object.entries(categorySpending)
			.map(([category, amount]) => ({
				category,
				amount,
				percentage:
					(amount / transactions.reduce((sum, t) => sum + t.amount, 0)) * 100,
			}))
			.sort((a, b) => b.amount - a.amount);

		const categoryData = {
			data,
			total: transactions.reduce((sum, t) => sum + t.amount, 0),
			period,
			topCategory: data[0] || null,
		};

		res.json({
			success: true,
			data: categoryData,
			timestamp: new Date(),
		});
	} catch (err) {
		console.error("Admin spending by category error:", err);
		res.status(500).json({ error: err.message });
	}
};
