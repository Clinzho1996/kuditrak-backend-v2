// backend/cron/budgetMonitor.js
import cron from "node-cron";
import Budget from "../models/Budget.js";
import {
	sendBudgetLimitReachedNotification,
	sendBudgetNearingLimitNotification,
} from "../services/notificationService.js";

// Run hourly
cron.schedule("0 * * * *", async () => {
	console.log("Checking budgets...");

	const budgets = await Budget.find({});

	for (const budget of budgets) {
		const spent = budget.spent || 0;
		const percentage = (spent / budget.amount) * 100;

		// Check if budget is nearing limit (80-99%)
		if (percentage >= 80 && percentage < 100 && !budget.notificationSent) {
			await sendBudgetNearingLimitNotification(
				budget.userId,
				budget.name,
				Math.round(percentage),
				budget.amount - spent,
				budget.amount,
			);
			budget.notificationSent = true;
			await budget.save();
		}

		// Check if budget limit reached
		if (spent >= budget.amount && !budget.limitReachedNotified) {
			await sendBudgetLimitReachedNotification(
				budget.userId,
				budget.name,
				budget.amount,
			);
			budget.limitReachedNotified = true;
			await budget.save();
		}

		// Reset notification flag when budget resets (new month)
		if (new Date().getDate() === 1 && budget.notificationSent) {
			budget.notificationSent = false;
			budget.limitReachedNotified = false;
			await budget.save();
		}
	}
});
