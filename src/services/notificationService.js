// backend/services/notificationTemplates.js (or update your existing file)
import { sendPushToUser } from "./pushService.js";

// Map notification types to templates
const NOTIFICATION_TEMPLATES = {
	BUDGET_NEARING_LIMIT: {
		title: "⚠️ Budget Alert",
		body: "You've used {percentage}% of your {budgetName} budget. Only ₦{remaining} left!",
		type: "budget_warning",
	},
	BUDGET_LIMIT_REACHED: {
		title: "🚨 Budget Limit Reached",
		body: "You've reached your {budgetName} budget limit of ₦{amount}!",
		type: "budget_exceeded",
	},
	TRANSACTION_CREDIT: {
		title: "📝 Income Recorded",
		body: "You recorded ₦{amount} income. New balance: ₦{balance}",
		type: "transaction_credit",
	},
	TRANSACTION_DEBIT: {
		title: "📝 Expense Recorded",
		body: "You recorded ₦{amount} expense. New balance: ₦{balance}",
		type: "transaction_debit",
	},
	SAVING_CREATED: {
		title: "🎯 New Saving Goal",
		body: "You created '{bucketName}' saving goal. Target: ₦{targetAmount}",
		type: "saving_created",
	},
	SAVING_UPDATED: {
		title: "📈 Saving Goal Updated",
		body: "Your '{bucketName}' goal is now at {progress}% (₦{currentAmount} / ₦{targetAmount})",
		type: "saving_updated",
	},
	SAVING_COMPLETED: {
		title: "🎉 Goal Achieved!",
		body: "Congratulations! You've reached your '{bucketName}' saving goal of ₦{targetAmount}!",
		type: "saving_completed",
	},
	SAVING_DELETED: {
		title: "🗑️ Saving Goal Removed",
		body: "Your '{bucketName}' saving goal has been deleted.",
		type: "saving_deleted",
	},
	WALLET_TOPUP_SUCCESS: {
		title: "💳 Wallet Top-up Successful",
		body: "₦{amount} added to your wallet. New balance: ₦{balance}",
		type: "topup_success",
	},
	WITHDRAWAL_SUCCESS: {
		title: "🏦 Withdrawal Successful",
		body: "₦{amount} withdrawn from your wallet. New balance: ₦{balance}",
		type: "withdrawal_success",
	},
	SUBSCRIPTION_EXPIRING: {
		title: "⚠️ Subscription Expiring Soon",
		body: "Your {plan} plan expires in {days} days. Renew to keep premium features!",
		type: "subscription_warning",
	},
	SUBSCRIPTION_RENEWED: {
		title: "✅ Subscription Renewed",
		body: "Your {plan} plan has been renewed. Next billing: {nextBillingDate}",
		type: "subscription_renewed",
	},
	INSUFFICIENT_BALANCE: {
		title: "⚠️ Low Balance Alert",
		body: "Your wallet balance (₦{balance}) is running low. Top up to avoid failed transactions!",
		type: "low_balance",
	},
};

// Helper to replace placeholders in template
const formatNotification = (template, data) => {
	let message = template.body;
	Object.keys(data).forEach((key) => {
		message = message.replace(new RegExp(`{${key}}`, "g"), data[key]);
	});
	return message;
};

// Send budget nearing limit notification
export const sendBudgetNearingLimitNotification = async (
	userId,
	budgetName,
	percentage,
	remaining,
	amount,
	budgetId,
) => {
	try {
		const template = NOTIFICATION_TEMPLATES.BUDGET_NEARING_LIMIT;
		const body = formatNotification(template, {
			percentage: Math.round(percentage),
			budgetName,
			remaining: remaining.toLocaleString(),
		});

		console.log(`Sending budget nearing limit notification to ${userId}`);

		const result = await sendPushToUser(userId, template.title, body, {
			type: template.type,
			budgetId: budgetId,
			percentage: percentage.toString(),
			budgetName: budgetName,
		});

		console.log("Budget notification result:", result);
		return result;
	} catch (error) {
		console.error("Error sending budget nearing limit notification:", error);
		throw error;
	}
};

// Send budget limit reached notification
export const sendBudgetLimitReachedNotification = async (
	userId,
	budgetName,
	amount,
	budgetId,
) => {
	try {
		const template = NOTIFICATION_TEMPLATES.BUDGET_LIMIT_REACHED;
		const body = formatNotification(template, {
			budgetName,
			amount: amount.toLocaleString(),
		});

		console.log(`Sending budget limit reached notification to ${userId}`);

		const result = await sendPushToUser(userId, template.title, body, {
			type: template.type,
			budgetId: budgetId,
			budgetName: budgetName,
			amount: amount.toString(),
		});

		console.log("Budget limit notification result:", result);
		return result;
	} catch (error) {
		console.error("Error sending budget limit reached notification:", error);
		throw error;
	}
};

// Send transaction notification
export const sendTransactionNotification = async (
	userId,
	amount,
	balance,
	type,
) => {
	try {
		const template =
			type === "income"
				? NOTIFICATION_TEMPLATES.TRANSACTION_CREDIT
				: NOTIFICATION_TEMPLATES.TRANSACTION_DEBIT;

		const body = formatNotification(template, {
			amount: amount.toLocaleString(),
			balance: balance.toLocaleString(),
		});

		console.log(`Sending ${type} transaction notification to ${userId}`);

		const result = await sendPushToUser(userId, template.title, body, {
			type: template.type,
			amount: amount.toString(),
			transactionType: type,
		});

		console.log("Transaction notification result:", result);
		return result;
	} catch (error) {
		console.error("Error sending transaction notification:", error);
		throw error;
	}
};

// Send goal notification (CBN-compliant version of sendSavingNotification)
export const sendGoalNotification = async (
	userId,
	goalName,
	allocatedAmount,
	goalAmount,
	action,
) => {
	try {
		let template;
		let body;
		let extraData = {};

		if (action === "created") {
			template = {
				title: "🎯 New Goal Created",
				body: "You created '{goalName}' goal. Target: ₦{goalAmount}",
				type: "goal_created",
			};
			body = formatNotification(template, {
				goalName,
				goalAmount: goalAmount.toLocaleString(),
			});
			extraData = { goalName, action: "created" };
		} else if (action === "deleted") {
			template = {
				title: "🗑️ Goal Removed",
				body: "Your '{goalName}' goal has been removed. Designated funds are back in your wallet.",
				type: "goal_deleted",
			};
			body = formatNotification(template, { goalName });
			extraData = { goalName, action: "deleted" };
		} else if (action === "completed") {
			template = {
				title: "🎉 Goal Achieved!",
				body: "Congratulations! You've reached your '{goalName}' goal of ₦{goalAmount}!",
				type: "goal_completed",
			};
			body = formatNotification(template, {
				goalName,
				goalAmount: goalAmount.toLocaleString(),
			});
			extraData = { goalName, action: "completed" };
		} else if (action === "committed") {
			template = {
				title: "🔒 Goal Commitment Activated",
				body: "You've committed to your '{goalName}' goal until {releaseDate}. Early release incurs a 7% fee.",
				type: "goal_committed",
			};
			body = formatNotification(template, {
				goalName,
				releaseDate: extraData.releaseDate || "the specified date",
			});
			extraData = { goalName, action: "committed" };
		} else if (action === "released") {
			template = {
				title: "🔓 Goal Commitment Released",
				body: "Your '{goalName}' goal commitment has ended. You can now withdraw designated funds without penalty.",
				type: "goal_released",
			};
			body = formatNotification(template, { goalName });
			extraData = { goalName, action: "released" };
		} else {
			const progress = Math.round((allocatedAmount / goalAmount) * 100);
			template = {
				title: "📈 Goal Progress Updated",
				body: "Your '{goalName}' goal is at {progress}% (₦{allocatedAmount} / ₦{goalAmount})",
				type: "goal_updated",
			};
			body = formatNotification(template, {
				goalName,
				progress,
				allocatedAmount: allocatedAmount.toLocaleString(),
				goalAmount: goalAmount.toLocaleString(),
			});
			extraData = {
				goalName,
				action: "updated",
				progress: progress.toString(),
			};
		}

		console.log(`Sending goal notification (${action}) to ${userId}`);

		const result = await sendPushToUser(userId, template.title, body, {
			type: template.type,
			...extraData,
		});

		console.log("Goal notification result:", result);
		return result;
	} catch (error) {
		console.error("Error sending goal notification:", error);
		throw error;
	}
};

// Send saving goal notification
export const sendSavingNotification = async (
	userId,
	bucketName,
	currentAmount,
	targetAmount,
	action,
) => {
	try {
		let template;
		let body;
		let extraData = {};

		if (action === "created") {
			template = NOTIFICATION_TEMPLATES.SAVING_CREATED;
			body = formatNotification(template, {
				bucketName,
				targetAmount: targetAmount.toLocaleString(),
			});
			extraData = { bucketName, action: "created" };
		} else if (action === "deleted") {
			template = NOTIFICATION_TEMPLATES.SAVING_DELETED;
			body = formatNotification(template, { bucketName });
			extraData = { bucketName, action: "deleted" };
		} else if (action === "completed") {
			template = NOTIFICATION_TEMPLATES.SAVING_COMPLETED;
			body = formatNotification(template, {
				bucketName,
				targetAmount: targetAmount.toLocaleString(),
			});
			extraData = { bucketName, action: "completed" };
		} else {
			const progress = Math.round((currentAmount / targetAmount) * 100);
			template = NOTIFICATION_TEMPLATES.SAVING_UPDATED;
			body = formatNotification(template, {
				bucketName,
				progress,
				currentAmount: currentAmount.toLocaleString(),
				targetAmount: targetAmount.toLocaleString(),
			});
			extraData = {
				bucketName,
				action: "updated",
				progress: progress.toString(),
			};
		}

		console.log(`Sending saving notification (${action}) to ${userId}`);

		const result = await sendPushToUser(userId, template.title, body, {
			type: template.type,
			...extraData,
		});

		console.log("Saving notification result:", result);
		return result;
	} catch (error) {
		console.error("Error sending saving notification:", error);
		throw error;
	}
};

// Send wallet top-up notification
export const sendTopUpNotification = async (userId, amount, balance) => {
	try {
		const template = NOTIFICATION_TEMPLATES.WALLET_TOPUP_SUCCESS;
		const body = formatNotification(template, {
			amount: amount.toLocaleString(),
			balance: balance.toLocaleString(),
		});

		console.log(`Sending top-up notification to ${userId}`);

		const result = await sendPushToUser(userId, template.title, body, {
			type: template.type,
			amount: amount.toString(),
		});

		console.log("Top-up notification result:", result);
		return result;
	} catch (error) {
		console.error("Error sending top-up notification:", error);
		throw error;
	}
};

// Send withdrawal notification
export const sendWithdrawalNotification = async (userId, amount, balance) => {
	try {
		const template = NOTIFICATION_TEMPLATES.WITHDRAWAL_SUCCESS;
		const body = formatNotification(template, {
			amount: amount.toLocaleString(),
			balance: balance.toLocaleString(),
		});

		console.log(`Sending withdrawal notification to ${userId}`);

		const result = await sendPushToUser(userId, template.title, body, {
			type: template.type,
			amount: amount.toString(),
		});

		console.log("Withdrawal notification result:", result);
		return result;
	} catch (error) {
		console.error("Error sending withdrawal notification:", error);
		throw error;
	}
};

// Send low balance notification
export const sendLowBalanceNotification = async (userId, balance) => {
	try {
		const template = NOTIFICATION_TEMPLATES.INSUFFICIENT_BALANCE;
		const body = formatNotification(template, {
			balance: balance.toLocaleString(),
		});

		console.log(`Sending low balance notification to ${userId}`);

		const result = await sendPushToUser(userId, template.title, body, {
			type: template.type,
			balance: balance.toString(),
		});

		console.log("Low balance notification result:", result);
		return result;
	} catch (error) {
		console.error("Error sending low balance notification:", error);
		throw error;
	}
};

// Send subscription notification
export const sendSubscriptionNotification = async (
	userId,
	plan,
	daysLeft,
	action,
) => {
	try {
		let template;
		let body;

		if (action === "expiring") {
			template = NOTIFICATION_TEMPLATES.SUBSCRIPTION_EXPIRING;
			body = formatNotification(template, {
				plan,
				days: daysLeft,
			});
		} else if (action === "renewed") {
			template = NOTIFICATION_TEMPLATES.SUBSCRIPTION_RENEWED;
			body = formatNotification(template, {
				plan,
				nextBillingDate: daysLeft,
			});
		} else {
			return;
		}

		console.log(`Sending subscription notification (${action}) to ${userId}`);

		const result = await sendPushToUser(userId, template.title, body, {
			type: template.type,
			plan,
			action,
		});

		console.log("Subscription notification result:", result);
		return result;
	} catch (error) {
		console.error("Error sending subscription notification:", error);
		throw error;
	}
};
