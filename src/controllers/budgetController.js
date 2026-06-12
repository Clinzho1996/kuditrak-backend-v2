import Budget from "../models/Budget.js";
import Transaction from "../models/Transaction.js";
import { checkLimits } from "../services/subscriptionService.js";

/*
|--------------------------------------------------------------------------
| Create Budget
|--------------------------------------------------------------------------
*/
export const createBudget = async (req, res) => {
	try {
		const { name, amount, frequency, startDate, endDate } = req.body;

		console.log("Creating budget for user:", req.user._id);
		console.log("Budget data:", {
			name,
			amount,
			frequency,
			startDate,
			endDate,
		});

		// Check limits - this will throw if limit is reached
		await checkLimits(req.user._id, "budget");

		const budget = await Budget.create({
			userId: req.user._id,
			name,
			amount,
			frequency,
			startDate,
			endDate,
		});

		console.log("Budget created successfully:", budget._id);

		res.status(201).json({
			success: true,
			budget,
			message: "Budget created successfully",
		});
	} catch (err) {
		console.error("Create budget error:", err.message);

		// Check if it's a limit error
		if (err.message.includes("limit reached")) {
			// Extract the limit from the error message
			const match = err.message.match(/(\d+)/);
			const limit = match ? parseInt(match[0]) : null;

			return res.status(403).json({
				success: false,
				message: err.message,
				code: "LIMIT_EXCEEDED",
				limitType: "budgets",
				limit: limit,
				plan: req.user?.subscription?.plan || "free",
			});
		}

		// Handle other errors
		res.status(500).json({
			success: false,
			message: err.message || "Failed to create budget",
			code: "CREATE_FAILED",
		});
	}
};

/*
|--------------------------------------------------------------------------
| Get All Budgets
|--------------------------------------------------------------------------
*/
export const getBudgets = async (req, res) => {
	try {
		const budgets = await Budget.find({ userId: req.user._id });

		res.status(200).json({
			success: true,
			count: budgets.length,
			budgets,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

/*
|--------------------------------------------------------------------------
| Get Budget By ID
|--------------------------------------------------------------------------
*/
export const getBudgetById = async (req, res) => {
	try {
		const { id } = req.params;

		const budget = await Budget.findOne({
			_id: id,
			userId: req.user._id,
		});

		if (!budget) {
			return res.status(404).json({ error: "Budget not found" });
		}

		res.status(200).json({
			success: true,
			budget,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

/*
|--------------------------------------------------------------------------
| Budget Insights
|--------------------------------------------------------------------------
*/
export const getBudgetInsights = async (req, res) => {
	try {
		const { id } = req.params;

		const budget = await Budget.findOne({
			_id: id,
			userId: req.user._id,
		});

		if (!budget) {
			return res.status(404).json({ error: "Budget not found" });
		}

		const startOfMonth = new Date(
			new Date().getFullYear(),
			new Date().getMonth(),
			1,
		);

		const transactions = await Transaction.find({
			userId: req.user._id,
			category: budget.name,
			type: "expense",
			createdAt: { $gte: startOfMonth },
		});

		const spent = transactions.reduce((sum, t) => sum + t.amount, 0);

		const remaining = budget.amount - spent;

		const percentageUsed = (spent / budget.amount) * 100;

		let status = "safe";

		if (percentageUsed > 90) status = "danger";
		else if (percentageUsed > 70) status = "warning";

		res.status(200).json({
			success: true,
			data: {
				budgetId: budget._id,
				name: budget.name,
				budgetAmount: budget.amount,
				spent,
				remaining,
				percentageUsed,
				status,
				transactionCount: transactions.length,
			},
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

/*
|--------------------------------------------------------------------------
| Update Budget
|--------------------------------------------------------------------------
*/
export const updateBudget = async (req, res) => {
	try {
		const { id } = req.params;

		const updated = await Budget.findOneAndUpdate(
			{ _id: id, userId: req.user._id },
			req.body,
			{ new: true },
		);

		if (!updated) {
			return res.status(404).json({ error: "Budget not found" });
		}

		res.status(200).json({
			success: true,
			budget: updated,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

/*
|--------------------------------------------------------------------------
| Delete Budget
|--------------------------------------------------------------------------
*/
export const deleteBudget = async (req, res) => {
	try {
		const { id } = req.params;

		const deleted = await Budget.findOneAndDelete({
			_id: id,
			userId: req.user._id,
		});

		if (!deleted) {
			return res.status(404).json({ error: "Budget not found" });
		}

		res.status(200).json({
			success: true,
			message: "Budget deleted",
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

/*
|--------------------------------------------------------------------------
| Get Total Budget Insights (Across All Budgets)
|--------------------------------------------------------------------------
*/
export const getTotalBudgetInsights = async (req, res) => {
	try {
		const userId = req.user._id;
		const startOfMonth = new Date(
			new Date().getFullYear(),
			new Date().getMonth(),
			1,
		);

		// Get all budgets for the user
		const budgets = await Budget.find({ userId });

		if (!budgets || budgets.length === 0) {
			return res.status(200).json({
				success: true,
				data: {
					totalBudget: 0,
					totalSpent: 0,
					totalRemaining: 0,
					overallPercentage: 0,
					budgetCount: 0,
					status: "no_budgets",
				},
			});
		}

		// Calculate totals
		let totalBudget = 0;
		let totalSpent = 0;

		for (const budget of budgets) {
			totalBudget += budget.amount;

			// Get transactions for this budget
			const transactions = await Transaction.find({
				userId,
				category: budget.name,
				type: "expense",
				createdAt: { $gte: startOfMonth },
			});

			const spent = transactions.reduce((sum, t) => sum + t.amount, 0);
			totalSpent += spent;
		}

		const totalRemaining = totalBudget - totalSpent;
		const overallPercentage =
			totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

		// Determine overall status
		let status = "safe";
		if (overallPercentage > 90) status = "danger";
		else if (overallPercentage > 70) status = "warning";

		res.status(200).json({
			success: true,
			data: {
				totalBudget,
				totalSpent,
				totalRemaining,
				overallPercentage,
				budgetCount: budgets.length,
				status,
				// Format for frontend compatibility
				spent: totalSpent,
				total: totalBudget,
				percentage: Math.round(overallPercentage),
			},
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};
