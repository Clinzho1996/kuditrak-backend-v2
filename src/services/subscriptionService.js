// services/subscriptionService.js
import { LIMITS } from "../config/subscriptionLimit.js";
import BankConnection from "../models/BankConnection.js";
import Budget from "../models/Budget.js";
import SavingsBucket from "../models/SavingsBucket.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";

export const checkLimits = async (userId, action) => {
	try {
		console.log(`Checking limits for user ${userId} on action: ${action}`);

		const user = await User.findById(userId);
		if (!user) {
			throw new Error("User not found");
		}

		const plan = user.subscription?.plan || "free";
		const limits = LIMITS[plan];

		console.log(`User plan: ${plan}, Limits:`, limits);

		switch (action) {
			case "manual_transaction":
				const txCount = await Transaction.countDocuments({
					userId,
					source: "manual",
				});

				console.log(
					`Manual transactions: ${txCount}/${limits.manualTransactions}`,
				);

				if (txCount >= limits.manualTransactions) {
					throw new Error(
						`Manual transaction limit reached (${limits.manualTransactions}). Upgrade your plan.`,
					);
				}
				break;

			case "bank_connection":
				const bankCount = await BankConnection.countDocuments({
					userId,
					status: "Active",
				});

				console.log(`Bank connections: ${bankCount}/${limits.bankConnections}`);

				if (bankCount >= limits.bankConnections) {
					throw new Error(
						`Bank connection limit reached (${limits.bankConnections}). Upgrade your plan.`,
					);
				}
				break;

			case "budget":
				const budgetCount = await Budget.countDocuments({ userId });

				console.log(`Budgets: ${budgetCount}/${limits.budgets}`);

				if (budgetCount >= limits.budgets) {
					throw new Error(
						`Budget limit reached (${limits.budgets}). Upgrade your plan.`,
					);
				}
				break;

			case "saving_bucket":
				const bucketCount = await SavingsBucket.countDocuments({ userId });

				console.log(`Saving buckets: ${bucketCount}/${limits.savingBuckets}`);

				if (bucketCount >= limits.savingBuckets) {
					throw new Error(
						`Saving bucket limit reached (${limits.savingBuckets}). Upgrade your plan.`,
					);
				}
				break;

			default:
				console.log(`Unknown action: ${action}`);
				break;
		}

		console.log(`✅ Limit check passed for ${action}`);
		return true;
	} catch (err) {
		console.error(`❌ Limit check failed for ${action}:`, err.message);
		throw err;
	}
};
