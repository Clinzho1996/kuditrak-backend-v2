import cron from "node-cron";
import BankConnection from "./models/BankConnection.js";

import Budget from "./models/Budget.js";
import User from "./models/User.js";
import { calculateUserInsights } from "./services/analyticsService.js";
import { pullTransactionsFromMono } from "./services/monoService.js";
import {
	sendBudgetLimitReachedNotification,
	sendBudgetNearingLimitNotification,
} from "./services/notificationService.js";
import { sendPush } from "./services/pushService.js";

// cron.js - Add startup confirmation
console.log("🕐 Initializing cron jobs...");

// Log when each cron job is registered
const registerCron = (schedule, name, job) => {
	console.log(`📅 Registering cron job: ${name} - Schedule: ${schedule}`);
	return cron.schedule(schedule, async () => {
		console.log(`⏰ Running cron job: ${name} at ${new Date().toISOString()}`);
		try {
			await job();
		} catch (error) {
			console.error(`❌ Cron job failed: ${name}`, error);
		}
	});
};

// Budget check every hour
registerCron("0 * * * *", "Budget Check", async () => {
	console.log("🔍 Checking budgets...");
	const budgets = await Budget.find({});
	console.log(`📊 Found ${budgets.length} budgets to check`);

	for (const budget of budgets) {
		const spent = budget.spent || 0;
		const percentage = (spent / budget.amount) * 100;

		if (percentage >= 80 && percentage < 100 && !budget.notificationSent) {
			console.log(
				`📢 Budget nearing limit: ${budget.name} (${Math.round(percentage)}%)`,
			);
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

		if (spent >= budget.amount && !budget.limitReachedNotified) {
			console.log(`🚨 Budget limit reached: ${budget.name}`);
			await sendBudgetLimitReachedNotification(
				budget.userId,
				budget.name,
				budget.amount,
			);
			budget.limitReachedNotified = true;
			await budget.save();
		}

		if (new Date().getDate() === 1 && budget.notificationSent) {
			console.log(`🔄 Resetting budget flags for: ${budget.name}`);
			budget.notificationSent = false;
			budget.limitReachedNotified = false;
			await budget.save();
		}
	}
	console.log("✅ Budget check completed");
});

// Daily budget alert at 8am
registerCron("0 8 * * *", "Daily Budget Alerts", async () => {
	const users = await User.find({ pushToken: { $exists: true } });
	console.log(`📱 Sending daily alerts to ${users.length} users`);

	for (const user of users) {
		try {
			await calculateUserInsights(user, true);
		} catch (err) {
			console.error(`Budget alert failed for ${user.email}: ${err.message}`);
		}
	}
	console.log("✅ Daily budget alerts sent");
});

// Weekly summary at Monday 9am
registerCron("0 9 * * MON", "Weekly Summary", async () => {
	const users = await User.find({ pushToken: { $exists: true } });
	console.log(`📊 Sending weekly summaries to ${users.length} users`);

	for (const user of users) {
		try {
			const insights = await calculateUserInsights(user, false);
			const { balance, totalSpent, totalSaved } = insights.data;
			console.log(
				`📧 Summary for ${user.email}: Balance ₦${balance}, Spent ₦${totalSpent}, Saved ₦${totalSaved}`,
			);
			await sendPush(
				user.pushToken,
				`📊 Weekly Summary: Balance ${balance}, Spent ${totalSpent}, Saved ${totalSaved}`,
			);
		} catch (err) {
			console.error(`Weekly summary failed for ${user.email}: ${err.message}`);
		}
	}
	console.log("✅ Weekly summaries sent");
});

// Daily transaction pull at 2am
registerCron("0 2 * * *", "Daily Transaction Pull", async () => {
	const connections = await BankConnection.find({ status: "Active" });
	console.log(
		`🏦 Pulling transactions for ${connections.length} bank connections`,
	);

	for (const conn of connections) {
		const since = conn.lastSync || new Date(Date.now() - 24 * 60 * 60 * 1000);
		console.log(`📥 Syncing ${conn.accountNumber} since ${since}`);

		try {
			await pullTransactionsFromMono(conn, since);
			conn.lastSync = new Date();
			await conn.save();
			console.log(`✅ Synced ${conn.accountNumber} successfully`);
		} catch (err) {
			console.error(
				`Failed to pull transactions for ${conn.accountNumber}:`,
				err.message,
			);
		}
	}
	console.log("✅ Daily transaction pull complete");
});

console.log("✅ All cron jobs registered successfully");
